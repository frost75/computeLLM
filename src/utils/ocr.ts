export const MINIMAX_API_KEY = 'sk-api-_ren9dbloS0Hzd_X-xnMNZ-xCL0cHe52pWMPCuCGN_bjEiDP3ZylJlcSz1HHOLbC_wH1i3K8HhA6u133cxgKCzS6ImW5iufMvD--Ohbhs114aZZS1dvx0gw';
import { Platform } from '../types';

export interface JdOcrResult {
  itemPromotion?: number;
  itemDiscount?: number;
  limitedTimeSubsidy?: number;
  fullReduction?: number;
  plusMemberDiscount?: number;
  governmentSubsidy?: number;
  nationalSubsidy?: number;
  storeCoupon?: number;
  normalCoupon?: number;
  jointCoupon?: number;
  bundleDiscount?: number;
  otherDiscount?: number;
  ecard?: number;
  giftCard?: number;
  paymentGift?: number;
  tradeInSubsidy?: number;
  tradeInOldMachine?: number;
  actualPayment?: number;
}

export interface TmallOcrResult {
  storeDiscount?: number;
  governmentSubsidy?: number;
  officialLimitedTimeSubsidy?: number;
  otherDiscount?: number;
  serviceFee?: number;
  screenshotActualPayment?: number;
  actualPayment?: number;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// 带重试的 fetch 函数
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<Response> => {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // 如果是 5xx 错误，尝试重试
      if (response.status >= 500 && response.status < 600 && attempt < maxRetries) {
        console.log(`MiniMax API 返回 ${response.status}，第 ${attempt}/${maxRetries} 次重试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      console.log(`MiniMax API 请求失败，第 ${attempt}/${maxRetries} 次重试...`, error);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }
  
  throw lastError || new Error('MiniMax API 请求失败，已重试 ' + maxRetries + ' 次');
};

export const recognizeImage = async (imageFile: File, platform: Platform = 'jd'): Promise<JdOcrResult | TmallOcrResult> => {


  const base64Image = await fileToBase64(imageFile);

  let prompt: string;

  if (platform === 'jd') {
    prompt = `请分析这张京东订单截图，提取以下优惠项的金额。

【核心规则】
1. 必须严格匹配字段名称：只有截图中明确出现对应文字时，才能提取该字段的金额
2. 如果截图中没有某个字段名称，该字段必须返回 null，绝对不能用其他字段的金额填充
3. 金额为纯数字（不含负号、¥符号），找不到返回 null
4. 只返回 JSON，不要其他文字

【截图区域说明】
京东订单截图通常包含以下区域：
- "支付优惠"区域：显示联合优惠券、礼品卡、支付有礼等
- "应收优惠"区域：显示单品促销、单品折扣等优惠项（可能在折叠菜单中）
- 订单金额明细：显示客户实付、订单金额等

【字段说明 - 按优先级严格匹配】
1. itemPromotion: 在"应收优惠"区域或任何位置出现"单品促销"四字时提取对应金额，否则 null
2. itemDiscount: 在"应收优惠"区域或任何位置出现"单品折扣"四字时提取对应金额，否则 null
3. limitedTimeSubsidy: 只有截图中出现"限时补贴"四字时才提取对应金额，否则 null
4. fullReduction: 只有截图中出现"满减"、"满送"、"满减满送"时才提取对应金额，否则 null
5. plusMemberDiscount: 只有截图中出现"plus会员95折"或"PLUS会员95折"时才提取对应金额，否则 null
6. governmentSubsidy: 只有截图中出现"政府补贴"时才提取对应金额，否则 null
7. nationalSubsidy: 只有截图中出现"国补"时才提取对应金额，否则 null
8. storeCoupon: 只有截图中出现"店铺东券"四字时才提取对应金额，否则 null
9. normalCoupon: 只有截图中出现"普通东券"四字时才提取对应金额，否则 null
10. jointCoupon: 在"支付优惠"区域出现"联合优惠券"时提取对应金额。【重要规则】如果截图中出现多笔"联合优惠券"金额，只允许识别金额为10元或12元的那一笔；如果多笔都是10元或12元，只取第一笔；如果没有任何一笔是10元或12元，则返回null。绝对禁止识别大于12元的联合优惠券金额，否则 null
11. bundleDiscount: 截图中可能出现多个"套装优惠"条目（如套装优惠 ¥100、套装优惠 ¥50等），需要识别所有套装优惠金额并计算合计值。如果找到多个套装优惠金额，将它们相加后返回合计值；如果只找到一个，返回该金额；如果没有找到，返回 null
12. otherDiscount: 只有截图中出现"临时优惠"四字时才提取对应金额，否则 null
13. ecard: 只有截图中出现"E卡"或"京东E卡"时才提取对应金额，否则 null
14. giftCard: 在"支付优惠"区域可能出现多个"礼品卡"条目（如礼品卡 ¥500、礼品卡 ¥88.81等），需要识别所有礼品卡金额并计算合计值。如果找到多个礼品卡金额，将它们相加后返回合计值；如果只找到一个，返回该金额；如果没有找到，返回 null
15. paymentGift: 在"支付优惠"区域出现"支付有礼"四字时提取对应金额，否则 null
16. tradeInSubsidy: 只有截图中出现"3C以旧换新补贴"、"以旧换新补贴"时才提取对应金额，否则 null
17. tradeInOldMachine: 只有截图中出现"3C以旧换新旧机抵扣"、"以旧换新旧机抵扣"、"旧机抵扣"时才提取对应金额，否则 null
18. actualPayment: 只有截图中出现"客户实付"四字时才提取对应金额，不要与"实付金额"混淆，否则 null

【返回格式 - 必须包含所有字段】
{"itemPromotion": 数字或null, "itemDiscount": 数字或null, "limitedTimeSubsidy": 数字或null, "fullReduction": 数字或null, "plusMemberDiscount": 数字或null, "governmentSubsidy": 数字或null, "nationalSubsidy": 数字或null, "storeCoupon": 数字或null, "normalCoupon": 数字或null, "jointCoupon": 数字或null, "bundleDiscount": 数字或null, "otherDiscount": 数字或null, "ecard": 数字或null, "giftCard": 数字或null, "paymentGift": 数字或null, "tradeInSubsidy": 数字或null, "tradeInOldMachine": 数字或null, "actualPayment": 数字或null}`;
  } else {
    // tmall
    prompt = `请分析这张天猫订单截图，提取以下优惠项的金额。

【重要规则】
- 必须严格匹配：只有截图中出现了字段名称对应的文字，才能提取该字段的金额
- 如果截图中没有某个字段名称，该字段必须返回 null，绝对不能用其他字段的金额填充
- 金额为数字（不含负号），找不到返回 null
- 只返回 JSON，不要其他文字

【特殊处理 - 服务费与实付金额】
- 服务费(serviceFee): 截图中可能出现"服务费"字样（如"服务费 全面保修二年 ¥87.00"），识别到后提取金额
- 截图实付金额(screenshotActualPayment): 截图中显示的"实付款"原始金额（如"实付款 ¥867.00"）
- 实际用户实付(actualPayment): 如果识别到服务费，则 actualPayment = screenshotActualPayment - serviceFee；如果没有服务费，则 actualPayment = screenshotActualPayment

【字段说明】
1. storeDiscount: 只有截图中出现"店铺优惠"或"店铺券"时才提取对应金额，否则 null
2. governmentSubsidy: 只有截图中出现"政府补贴"或"国补"时才提取对应金额，否则 null
3. officialLimitedTimeSubsidy: 只有截图中出现"官方限时补贴"时才提取对应金额，否则 null
4. otherDiscount: 只有截图中明确出现"临时优惠"四字时才提取对应金额，绝对禁止将"平台优惠"识别为其他折扣，否则 null
5. serviceFee: 只有截图中出现"服务费"字样时才提取对应金额，否则 null
6. screenshotActualPayment: 截图中显示的"实付款"原始金额，必须提取
7. actualPayment: 计算后的实际用户实付金额 = screenshotActualPayment - (serviceFee || 0)

【返回格式】
{"storeDiscount": 数字或null, "governmentSubsidy": 数字或null, "officialLimitedTimeSubsidy": 数字或null, "otherDiscount": 数字或null, "serviceFee": 数字或null, "screenshotActualPayment": 数字或null, "actualPayment": 数字或null}`;
  }

  const response = await fetchWithRetry('https://api.minimax.chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'abab7-chat-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax API 请求失败: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      if (platform === 'jd') {
        return {
          itemPromotion: parsed.itemPromotion ?? undefined,
          itemDiscount: parsed.itemDiscount ?? undefined,
          limitedTimeSubsidy: parsed.limitedTimeSubsidy ?? undefined,
          fullReduction: parsed.fullReduction ?? undefined,
          plusMemberDiscount: parsed.plusMemberDiscount ?? undefined,
          governmentSubsidy: parsed.governmentSubsidy ?? undefined,
          nationalSubsidy: parsed.nationalSubsidy ?? undefined,
          storeCoupon: parsed.storeCoupon ?? undefined,
          normalCoupon: parsed.normalCoupon ?? undefined,
          jointCoupon: parsed.jointCoupon ?? undefined,
          bundleDiscount: parsed.bundleDiscount ?? undefined,
          otherDiscount: parsed.otherDiscount ?? undefined,
          ecard: parsed.ecard ?? undefined,
          giftCard: parsed.giftCard ?? undefined,
          paymentGift: parsed.paymentGift ?? undefined,
          tradeInSubsidy: parsed.tradeInSubsidy ?? undefined,
          tradeInOldMachine: parsed.tradeInOldMachine ?? undefined,
          actualPayment: parsed.actualPayment ?? undefined,
        };
      } else {
        // tmall
        return {
          storeDiscount: parsed.storeDiscount ?? undefined,
          governmentSubsidy: parsed.governmentSubsidy ?? undefined,
          officialLimitedTimeSubsidy: parsed.officialLimitedTimeSubsidy ?? undefined,
          otherDiscount: parsed.otherDiscount ?? undefined,
          serviceFee: parsed.serviceFee ?? undefined,
          actualPayment: parsed.actualPayment ?? undefined,
        };
      }
    }
  } catch (e) {
    console.error('解析 MiniMax 响应失败:', e, content);
  }

  return {};
};

export const handlePasteEvent = async (
  event: ClipboardEvent,
  onRecognized: (result: JdOcrResult | TmallOcrResult) => void
): Promise<void> => {
  const items = event.clipboardData?.items;

  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();

      if (file) {
        try {
          const ocrResult = await recognizeImage(file);
          onRecognized(ocrResult);
        } catch (error) {
          console.error('粘贴图片识别失败:', error);
          alert('图片识别失败，请手动输入金额');
        }
        return;
      }
    }
  }
};

export const MINIMAX_URL = 'https://api.minimax.chat/v1/chat/completions';
export const MINIMAX_MODEL = 'MiniMax-M3.1-Flash';

