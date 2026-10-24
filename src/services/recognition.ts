import { MINIMAX_API_KEY, MINIMAX_MODEL, MINIMAX_URL } from "../utils/ocr";
import {
  FIELD_LABELS,
  CATEGORIES,
  type Recognition,
  type Field,
  type Observation,
  type Discount,
} from "../domain/contracts";
import { money } from "../domain/money";
import { classify, refundLabel, spendingField } from "../domain/automation";
export const PROMPT_VERSION = "recognition-v6";
export const prompt = (
  platform: string,
  side: string,
) => `你是客服订单截图识别助手。本次平台${platform}，订单侧${side}。一次完成字段提取、优惠归类、承担方建议、付款状态、政府补贴包含关系及完整性检查，不调用工具，不计算退差金额。
图片是同一张订单截图的原图及上下放大视图，不是多笔订单，重叠位置只计一次。请先遍历整个金额区域，再输出JSON：订单总额、应收优惠及其展开明细、支付优惠及其展开明细、客户实付、应收/待支付、价保。灰色背景框、表格左右两列、同一行左右两项都必须逐项读完；不要只读最醒目的单品促销或只读应收优惠区域。限时补贴、政府补贴/国补、联合优惠券可能在支付优惠的灰框中，不能因为位于支付区而遗漏。金额紧邻冒号或在下一行时按布局对应；放大核对易混数字，不用记忆或示例数字代替截图。
支付优惠标题行是总额；它下方灰框中的文字才是项目名。国补标签可能断行为“国补-京东支”和“付非整单配资”，仍需合并识别为国补项目，金额取同格显示数字。不要用父标题“支付优惠”替代灰框内国补、支付有礼或联合优惠券的真实名称；这些项目即使金额恰好等于支付优惠总额也必须保留明细。
输出前在同一次推理内复查每个展开优惠框的所有行是否都有去向（discounts、spendingRows或refundRows）；多笔同名联合券及多笔价保逐笔保留。discounts和spendingRows每一行必须增加sourceRegion字段，截图应收优惠框内填receivable，支付优惠框内填payment，独立其他区域填other；不能按优惠类别猜区域。优惠总额仅用于检查有无漏读，绝不能按总额与已读项目的差值编造补贴或其他明细。若总额明显有项目尚未识别，应重新看放大图；仍看不清才标discountsComplete=false并写明具体区域，禁止漏项却标完整。
按截图输出唯一JSON，顶层必须符合结构：
{"fields":{"actualPayment":{"amount":"1681.13","presence":"visible","evidence":"客户实付1681.13","confidence":1}},"discounts":[{"name":"单品折扣","amount":"100","category":"itemDiscount","payer":"store","payerSource":"inferred","payerReason":"单品折扣通常由商家承担","confidence":0.95,"evidence":"单品折扣100","sourceRegion":"receivable"}],"spendingRows":[{"name":"支付有礼","amount":"0.20","field":"paymentGift","evidence":"支付有礼0.20","sourceRegion":"payment"}],"refundRows":[],"paymentStatus":"paid","subsidyInTotals":"unknown","refundAlreadyIncluded":false,"extrasIncluded":false,"discountsComplete":true,"spendingComplete":true,"scopeConfirmed":true,"exceptions":[],"notices":[]}
示例数字不可复制。fields的白名单及中文含义：${JSON.stringify(FIELD_LABELS)}。每项金额以原文字串返回，最多3位小数，不计算合计；presence只用visible/absent/unknown，证据必须准确。discountTotal/platformCoupon不填写，由代码汇总。
discounts逐行保存原名称、金额、类别、承担方，类别枚举${Object.keys(CATEGORIES).join("|")}。不要把应收优惠/支付优惠等汇总行放入discounts。名称明确的单品促销/单品折扣等直接分类，不要求客服确认类别。多笔套装优惠全部保留；联合优惠券所有金额原样保留，由代码应用特殊口径。
承担方请结合标签、所在区域和常见京东/天猫订单优惠含义给出最可能的platform或store，不使用unknown交回客服。平台券、京东券、普通东券通常platform；单品促销、单品折扣、店铺券、套装优惠、商家临时优惠通常store；政府/国家补贴选platform但不是平台券。京东联合优惠券逐笔保留，10元或12元商家承担，其他金额平台承担。明确承担证据payerSource=evidence；经验判断payerSource=inferred，并写简短payerReason。confidence反映把握，疑点仅写notices，不把猜测写成截图证据。
费用项价保、价保、保价等负数属于已经退过的差价，放fields.refundAmount保留负号，不放discounts，不按负优惠报错；代码冲减净支出。多笔按spendingRows之外的refundRows逐笔返回{name,amount,evidence}；不要合计。refundAlreadyIncluded仅当截图显示客户实付本身已扣该退款时true，否则false。不把费用项价保认定为未覆盖的部分退款。
paymentStatus paid/unpaid/unknown：原订单默认已付款、现订单默认未付款；截图明确有相反状态时采用截图。现订单客户实付0不能作为应付金额；dueAmount识别应收金额/待支付金额，不能混为应收优惠。
subsidyInTotals included/excluded/unknown：根据政府补贴所在明细与汇总的包含关系判断；有补贴明细且属于支付/应收优惠列表时included；单列且不含在总额时excluded；无补贴且完整总额清楚时excluded。不自行计算补贴。天猫actualPayment提取原始实付款，serviceFee单列，由代码扣减。
spendingRows保存每笔E卡/礼品卡/支付有礼/以旧换新补贴/旧机抵扣，结构{name,amount,field,evidence,sourceRegion}，field取ecard/giftCard/paymentGift/tradeInSubsidy/tradeInOldMachine。fields中以上任一支付组成字段为visible时，spendingRows必须同时保存其每一笔原始明细，禁止只填fields却留spendingRows空数组。sourceRegion取receivable/payment/other且每笔必填。这些是用户支出的支付组成，不是商家或平台券，即使位于支付优惠区域也禁止放入discounts。不要把总额再放入明细。extrasIncluded只在应付金额已经包含这些支出项目时true，避免重复叠加。退差按付款完成后结果比较；客户实付为0时不是零元购，需要提取应付金额与总额用于回算；“实付金额”不得代替“客户实付”。应收金额如果尚未扣除单列支付优惠，不是最终待付款额，应返回dueAmount为absent，由总额回算；如已经扣除支付优惠才可作为dueAmount。
完整金额区域中未出现的可选项使用absent；裁切或金额模糊用unknown。discountsComplete和spendingComplete仅反映对应金额区域是否完整，不能因为图上没商品信息就设false。只有明确多商品/多数量、取消、部分退货或非价保的部分退款才放exceptions。没有这些线索且金额区清楚时scopeConfirmed=true。不要求客服逐项checklist。notices只保存真正影响判断的模糊项或判断提示。`;
const completePrompt = (platform: string, side: string) =>
  prompt(platform, side) +
  `\n必须把fields以下全部字段逐一返回，不得只返回actualPayment，未显示的字段返回unknown或absent。特别检查费用项价保负数、订单金额和两个优惠总额，不可遗漏。refundRows始终返回数组。完整fields结构（按截图填入，不是示例数字）：\n${JSON.stringify(
    Object.fromEntries(
      Object.entries(FIELD_LABELS)
        .filter(([k]) => !["discountTotal", "platformCoupon"].includes(k))
        .map(([k, label]) => [
          k,
          { amount: null, presence: "unknown", evidence: label, confidence: 0 },
        ]),
    ),
  )}\n最终JSON输出检查：每一个discounts对象和spendingRows对象必须包含sourceRegion（只能是receivable/payment/other），不可省略！支付组成在fields可见时，spendingRows不得为空。费用项价保逐笔进入refundRows，不纳入优惠合计核对。仔细复看单品促销小字的数字，逐字抄录，必要时用放大视图核实，不要把字形相近的数字抄错。发现同区域明细之和与截图优惠总额不符时，再逐字读图核查，只纠正实际看到的数字，禁止用差额反推金额。`;
export const productionPrompt = completePrompt;
// 一次请求附原图及两个重叠放大区域。只增加同次视觉输入，不增加LLM往返。
export async function recognitionViews(dataUrl: string): Promise<string[]> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("截图无法读取，请重新上传"));
    img.src = dataUrl;
  });
  const width = source.naturalWidth, height = source.naturalHeight;
  const outputWidth = Math.min(2400, Math.max(1600, width));
  const cropHeight = Math.ceil(height * 0.6);
  const views = [dataUrl];
  for (const y of [0, Math.max(0, height - cropHeight)]) {
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = Math.round(cropHeight * outputWidth / width);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法生成截图放大区域");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, y, width, cropHeight, 0, 0, canvas.width, canvas.height);
    views.push(canvas.toDataURL("image/png"));
  }
  return views;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function validateRecognition(
  raw: unknown,
  side: string,
  strict = false,
): Recognition {
  if (
    !object(raw) ||
    !object(raw.fields) ||
    !Array.isArray(raw.discounts) ||
    !Array.isArray(raw.exceptions) ||
    raw.exceptions.some((x) => typeof x !== "string")
  )
    throw new Error("识别格式不完整，请重试或手动录入");
  if (
    !["paid", "unpaid", "unknown"].includes(String(raw.paymentStatus)) ||
    !["included", "excluded", "unknown"].includes(String(raw.subsidyInTotals))
  )
    throw new Error("订单状态识别格式无效");
  for (const key of ["discountsComplete", "spendingComplete", "scopeConfirmed"])
    if (typeof raw[key] !== "boolean") throw new Error("识别完整度状态缺失");
  if (
    strict &&
    Object.keys(FIELD_LABELS)
      .filter((k) => !["discountTotal", "platformCoupon"].includes(k))
      .some((k) => !Object.prototype.hasOwnProperty.call(raw.fields, k))
  )
    throw new Error("识别遗漏关键字段，请重新识别该图");
  const fields: Partial<Record<Field, Observation>> = {};
  for (const [key, v] of Object.entries(raw.fields)) {
    if (
      !(key in FIELD_LABELS) ||
      key === "discountTotal" ||
      key === "platformCoupon"
    )
      continue;
    if (
      !object(v) ||
      !["visible", "absent", "unknown"].includes(String(v.presence)) ||
      typeof v.evidence !== "string" ||
      typeof v.confidence !== "number" ||
      v.confidence < 0 ||
      v.confidence > 1
    )
      throw new Error("字段证据格式无效");
    if (v.presence !== "unknown" && !v.evidence.trim())
      throw new Error("识别缺少截图证据");
    if (v.presence === "visible") {
      if (typeof v.amount !== "string")
        throw new Error("识别金额必须是原文数字");
      money(v.amount);
    }
    fields[key as Field] = {
      amount: v.presence === "visible" ? (v.amount as string) : null,
      presence: v.presence as Observation["presence"],
      evidence: v.evidence,
      confidence: v.confidence,
    };
  }
  // 部分模型将汇总行放进discounts：移回独立总额字段，避免遗漏或重复计入。
  for (const row of raw.discounts)
    if (
      object(row) &&
      typeof row.name === "string" &&
      typeof row.amount === "string"
    ) {
      const key = /^支付优惠(总额|合计)?$/.test(row.name.trim())
        ? "paymentDiscountTotal"
        : /^应收优惠(总额|合计)?$/.test(row.name.trim())
          ? "receivableDiscountTotal"
          : null;
      if (key && fields[key]?.presence !== "visible") {
        money(row.amount);
        fields[key] = {
          amount: row.amount,
          presence: "visible",
          evidence: String(row.evidence ?? row.name),
          confidence: typeof row.confidence === "number" ? row.confidence : 0.8,
        };
      }
    }
  const refundRows = [
    ...raw.discounts.filter(
      (v) => object(v) && typeof v.name === "string" && refundLabel(v.name),
    ),
    ...(Array.isArray(raw.refundRows) ? raw.refundRows : []),
  ];
  if (refundRows.length) {
    let total = 0;
    for (const row of refundRows) {
      if (!object(row) || typeof row.amount !== "string")
        throw new Error("价保金额识别不清，请补充清晰截图");
      total += Math.abs(money(row.amount));
    }
    fields.refundAmount = {
      amount: String(total / 1000),
      presence: "visible",
      evidence: "已退价保明细，由代码合计",
      confidence: 1,
    };
  }
  const discounts = raw.discounts
    .filter(
      (v) =>
        !(
          object(v) &&
          typeof v.name === "string" &&
          (refundLabel(v.name) ||
            /^(应收优惠|支付优惠)(总额|合计)?$/.test(v.name.trim()) || spendingField(v.name))
        ),
    )
    .map((v): Discount => {
      if (
        !object(v) ||
        typeof v.name !== "string" ||
        typeof v.amount !== "string" ||
        typeof v.category !== "string" ||
        !(v.category in CATEGORIES) ||
        !["platform", "store", "unknown"].includes(String(v.payer)) ||
        typeof v.evidence !== "string" ||
        !v.evidence.trim() ||
        typeof v.confidence !== "number" ||
        v.confidence < 0 ||
        v.confidence > 1
      )
        throw new Error("优惠明细识别格式无效");
      if (money(v.amount) < 0)
        throw new Error(`“${v.name}”为负数且不是价保项目，请补充清晰截图`);
      const category = classify(v.name, v.category as Discount["category"], "");
      const guessed = v.payer === "unknown";
      const payer = guessed
        ? [
            "jointCoupon",
            "normalCoupon",
            "nationalSubsidy",
            "governmentSubsidy",
          ].includes(category)
          ? "platform"
          : "store"
        : v.payer;
      return {
        ...v,
        category,
        payer,
        confidence: guessed ? Math.min(v.confidence, 0.65) : v.confidence,
        payerSource: guessed
          ? "inferred"
          : v.payerSource === "evidence"
            ? "evidence"
            : "inferred",
        payerReason:
          typeof v.payerReason === "string"
            ? v.payerReason
            : guessed
              ? "按优惠名称自动建议，可点选切换"
              : "根据优惠含义自动判断",
      } as Discount;
    });
  const lowConfidence =
    Object.values(fields).some(
      (v) => v && v.presence === "visible" && v.confidence < 0.7,
    ) || discounts.some((v) => v.confidence < 0.7);
  if (
    discounts.some((v) =>
      /^(应收优惠|支付优惠)(总额|合计)?$/.test(v.name.trim()),
    )
  )
    throw new Error("模型把汇总金额混入优惠明细，请重试或手动核对");
  void side;
  const spendingRows: NonNullable<Recognition["spendingRows"]> = [];
  if (raw.spendingRows !== undefined) {
    if (!Array.isArray(raw.spendingRows)) throw new Error("支出明细格式错误");
    for (const row of raw.spendingRows) {
      if (
        !object(row) ||
        typeof row.name !== "string" ||
        typeof row.amount !== "string" ||
        typeof row.evidence !== "string" ||
        !row.evidence.trim() ||
        ![
          "ecard",
          "giftCard",
          "paymentGift",
          "tradeInSubsidy",
          "tradeInOldMachine",
        ].includes(String(row.field))
      )
        throw new Error("支出明细缺少金额或证据");
      money(row.amount);
      spendingRows.push(row as unknown as (typeof spendingRows)[number]);
    }
  }
  // 模型可能受“支付优惠”分区误导；按字段身份纠正，不让支付组成进入D或Q。
  for (const row of raw.discounts) {
    if (!object(row) || typeof row.name !== "string" || typeof row.amount !== "string") continue;
    const field = spendingField(row.name);
    if (!field) continue;
    money(row.amount);
    if (!spendingRows.some(r => r.field === field && r.name === row.name && r.amount === row.amount))
      spendingRows.push({ name: row.name, amount: row.amount, field, evidence: String(row.evidence ?? row.name),
        sourceRegion: ["receivable", "payment", "other"].includes(String(row.sourceRegion)) ? row.sourceRegion as "receivable" | "payment" | "other" : undefined });
  }
  const completenessNotices: string[] = [];
  const detailRows = [...discounts, ...spendingRows];
  const regionAvailable = detailRows.every(row => ["receivable", "payment", "other"].includes(String(row.sourceRegion)));
  if (strict && detailRows.length && !regionAvailable)
    completenessNotices.push("优惠明细缺少来源区域，无法自动核对明细完整性，请重新识别或核对金额区域");
  if (regionAvailable) {
    for (const [region, key, label] of [
      ["receivable", "receivableDiscountTotal", "应收优惠"],
      ["payment", "paymentDiscountTotal", "支付优惠"],
    ] as const) {
      const total = fields[key];
      if (total?.presence !== "visible" || total.amount === null) continue;
      const observedSum = detailRows.filter(row => row.sourceRegion === region)
        .reduce((n, row) => n + money(row.amount), 0);
      if (Math.abs(observedSum - money(total.amount)) > 10)
        completenessNotices.push(`${label}总额与逐笔明细不一致，请核对该区域是否漏读或金额误识别`);
    }
  }
  return {
    raw: structuredClone(raw),
    refundAlreadyIncluded: raw.refundAlreadyIncluded === true,
    extrasIncluded: raw.extrasIncluded === true,
    notices: [
      ...completenessNotices,
      ...(Array.isArray(raw.notices)
        ? raw.notices.filter((v): v is string => typeof v === "string")
        : []),
      ...(lowConfidence
        ? ["部分字段识别把握较低，已用黄色标注，建议重点查看原图"]
        : []),
    ],
    fields,
    discounts,
    spendingRows,
    paymentStatus: raw.paymentStatus as Recognition["paymentStatus"],
    subsidyInTotals: raw.subsidyInTotals as Recognition["subsidyInTotals"],
    discountsComplete: (raw.discountsComplete as boolean) && completenessNotices.length === 0,
    spendingComplete: raw.spendingComplete as boolean,
    scopeConfirmed: raw.scopeConfirmed as boolean,
    exceptions: raw.exceptions as string[],
    metadata: {
      provider: "MiniMax",
      model: MINIMAX_MODEL,
      adapterVersion: "adapter-v2",
      promptVersion: PROMPT_VERSION,
      time: new Date().toISOString(),
    },
  };
}
export async function recognize(
  dataUrl: string,
  platform: string,
  side: string,
  signal: AbortSignal,
): Promise<Recognition> {
  const views = await recognitionViews(dataUrl);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort);
    try {
      if (signal.aborted) throw new Error("识别已取消");
      const response = await fetch(MINIMAX_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: MINIMAX_MODEL,
          max_tokens: 12000,
          response_format: { type: "json_object" },
          reasoning_split: true,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                ...views.map(url => ({ type: "image_url", image_url: { url } })),
                { type: "text", text: completePrompt(platform, side) },
              ],
            },
          ],
        }),
      });
      if (!response.ok) {
        if (response.status >= 500 && attempt < 2) continue;
        throw new Error(`模型服务请求失败（${response.status}），请重试`);
      }
      const data = await response.json();
      if (data.base_resp?.status_code)
        throw new Error(`模型服务返回错误（${data.base_resp.status_code}）`);
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("模型返回空内容");
      const clean = content
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, "");
      return validateRecognition(JSON.parse(clean), side, true);
    } catch (e) {
      lastError = e;
      if (signal.aborted) throw new Error("识别已取消");
      if (!(e instanceof TypeError) && (e as Error).name !== "AbortError")
        throw e;
      if (e instanceof SyntaxError || attempt === 2)
        throw new Error(
          e instanceof SyntaxError
            ? "模型返回格式无效，请重试"
            : (e as Error).message === "This operation was aborted"
              ? "识别超时，请重试"
              : (e as Error).message,
        );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  throw lastError;
}
