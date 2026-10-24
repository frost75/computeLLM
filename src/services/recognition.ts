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
export const PROMPT_VERSION = "recognition-v7-transcribe";
export const prompt = (
  platform: string,
  side: string,
) => `只抄录订单截图，不计算、不判断退差/承担方/权限。本次平台${platform}，订单侧${side}。
返回紧凑JSON：{"f":{},"r":[],"complete":true,"unclear":[],"exceptions":[]}。
f只填看得到的汇总字段，值为原文数字字符串，看不清填"?"，未出现不填。字段键：${JSON.stringify(Object.fromEntries(Object.entries(FIELD_LABELS).filter(([key]) => !["discountTotal", "platformCoupon", "refundAmount", "ecard", "giftCard", "paymentGift", "tradeInSubsidy", "tradeInOldMachine", "subsidyAmount"].includes(key))))}。
“客户实付”才填actualPayment；“实付金额”不能代替客户实付；应收金额/待付款填dueAmount。应收优惠和支付优惠是两个不同汇总字段。
orderAmount必须同时看见“订单金额”标签和它的原金额才填写；该行被截图裁掉时不填orderAmount，禁止用应收金额加优惠反推。代码会处理缺失，不需要补造字段。使用余额显示“--”代表无金额，不填f或r；不能因为未展示订单金额就判整张优惠区域不完整。
r逐笔抄所有明细，每行格式["原项目名称","原金额","r或p或o"]，r=应收优惠框，p=支付优惠框，o=其他位置。必须遍历灰框左右两列，包括单品促销/折扣、限时补贴、联合券、国补、E卡、礼品卡、支付有礼、以旧换新、旧机抵扣、每笔价保退款。相同名称多笔也分别保留，不合计，不把汇总标题再当明细；负数价保保留负号。
只抄金额明细弹窗中的汇总、优惠、支付、退款；下方“商品/数量/商品总额/实付金额”商品表的商品名称和价格不属于优惠明细，禁止放进r，尤其商品表的0不是额外优惠。
灰框项目名可能换行，“国补-京东支/付非整单配资”合并为原名称；支付优惠标题下面的国补不能抄成“支付优惠”。保留原数字，不从合计反推。只输出字段和行，不输出证据重复文本/分类/解释。完整金额区可读complete=true；裁切或模糊complete=false，unclear写原字段名。exceptions只抄明确出现的多商品多数量/取消/部分退货/非价保退款文字，无则空数组。`;
export const productionPrompt = prompt;
// Compact transport is expanded locally; standard fixtures and historical caches remain compatible.
export function expandTranscription(raw: unknown): unknown {
  if (!object(raw) || !object(raw.f) || !Array.isArray(raw.r)) return raw;
  if (typeof raw.complete !== "boolean") throw new Error("截图完整度未返回");
  const fields: Record<string, Observation> = {};
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (["discountTotal", "platformCoupon"].includes(key)) continue;
    const amount = raw.f[key];
    if (amount !== undefined && amount !== "?" && typeof amount !== "string")
      throw new Error("金额必须按原文返回字符串");
    fields[key] =
      amount !== undefined && amount !== "?"
        ? {
            amount,
            presence: "visible",
            confidence: 1,
            evidence: `${label} ${amount}`,
          }
        : {
            amount: null,
            presence: amount === "?" || !raw.complete ? "unknown" : "absent",
            confidence: 1,
            evidence: amount === "?" ? `${label}看不清` : "完整金额区域未显示",
          };
  }
  const discounts: unknown[] = [],
    spendingRows: unknown[] = [],
    refundRows: unknown[] = [];
  for (const row of raw.r) {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      typeof row[0] !== "string" ||
      typeof row[1] !== "string" ||
      !["r", "p", "o"].includes(row[2])
    )
      throw new Error("逐笔明细缺少原文金额或区域");
    const [name, amount, region] = row;
    if (/^使用余额$/.test(name.trim()) && /^[\s—–-]+$/.test(amount)) continue;
    money(amount);
    const sourceRegion =
      region === "r" ? "receivable" : region === "p" ? "payment" : "other";
    const evidence = `${name} ${amount}`;
    if (refundLabel(name)) {
      refundRows.push({ name, amount, evidence });
      continue;
    }
    const field = spendingField(name);
    if (field) {
      spendingRows.push({ name, amount, field, sourceRegion, evidence });
      continue;
    }
    const category = classify(name, "unknown", "");
    const payer =
      [
        "normalCoupon",
        "limitedTimeSubsidy",
        "officialLimitedTimeSubsidy",
      ].includes(category) || /平台券|京东券/.test(name)
        ? "platform"
        : "store";
    discounts.push({
      name,
      amount,
      category,
      payer,
      payerSource: "inferred",
      payerReason: "代码按名称给出默认承担方，待复核",
      confidence: 0.75,
      sourceRegion,
      evidence,
    });
  }
  const subsidized = discounts.some(
    (row) =>
      object(row) &&
      ["governmentSubsidy", "nationalSubsidy"].includes(String(row.category)) &&
      row.sourceRegion !== "other",
  );
  return {
    fields,
    discounts,
    spendingRows,
    refundRows,
    paymentStatus: "unknown",
    subsidyInTotals: subsidized ? "included" : "excluded",
    refundAlreadyIncluded: false,
    extrasIncluded: false,
    discountsComplete: raw.complete,
    spendingComplete: raw.complete,
    scopeConfirmed: true,
    exceptions: Array.isArray(raw.exceptions) ? raw.exceptions : [],
    notices: Array.isArray(raw.unclear)
      ? raw.unclear.map((value) => `截图字段待核对：${String(value)}`)
      : [],
  };
}
// 一次请求附原图及两个重叠放大区域。只增加同次视觉输入，不增加LLM往返。
export async function recognitionViews(dataUrl: string): Promise<string[]> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("截图无法读取，请重新上传"));
    img.src = dataUrl;
  });
  const width = source.naturalWidth,
    height = source.naturalHeight;
  const outputWidth = Math.min(2400, Math.max(1600, width));
  const cropHeight = Math.ceil(height * 0.6);
  const views = [dataUrl];
  for (const y of [0, Math.max(0, height - cropHeight)]) {
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = Math.round((cropHeight * outputWidth) / width);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法生成截图放大区域");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      source,
      0,
      y,
      width,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
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
  raw = expandTranscription(raw);
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
            /^(应收优惠|支付优惠)(总额|合计)?$/.test(v.name.trim()) ||
            spendingField(v.name))
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
        ? ["jointCoupon", "normalCoupon"].includes(category)
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
    if (
      !object(row) ||
      typeof row.name !== "string" ||
      typeof row.amount !== "string"
    )
      continue;
    const field = spendingField(row.name);
    if (!field) continue;
    money(row.amount);
    if (
      !spendingRows.some(
        (r) =>
          r.field === field && r.name === row.name && r.amount === row.amount,
      )
    )
      spendingRows.push({
        name: row.name,
        amount: row.amount,
        field,
        evidence: String(row.evidence ?? row.name),
        sourceRegion: ["receivable", "payment", "other"].includes(
          String(row.sourceRegion),
        )
          ? (row.sourceRegion as "receivable" | "payment" | "other")
          : undefined,
      });
  }
  const completenessNotices: string[] = [];
  const detailRows = [...discounts, ...spendingRows];
  const regionAvailable = detailRows.every((row) =>
    ["receivable", "payment", "other"].includes(String(row.sourceRegion)),
  );
  if (strict && detailRows.length && !regionAvailable)
    completenessNotices.push(
      "优惠明细缺少来源区域，无法自动核对明细完整性，请重新识别或核对金额区域",
    );
  if (regionAvailable) {
    for (const [region, key, label] of [
      ["receivable", "receivableDiscountTotal", "应收优惠"],
      ["payment", "paymentDiscountTotal", "支付优惠"],
    ] as const) {
      const total = fields[key];
      if (total?.presence !== "visible" || total.amount === null) continue;
      const observedSum = detailRows
        .filter((row) => row.sourceRegion === region)
        .reduce((n, row) => n + money(row.amount), 0);
      if (Math.abs(observedSum - money(total.amount)) > 10)
        completenessNotices.push(
          `${label}总额与逐笔明细不一致，请核对该区域是否漏读或金额误识别`,
        );
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
    discountsComplete:
      (raw.discountsComplete as boolean) && completenessNotices.length === 0,
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
  let lastError: unknown;
  let partial: Recognition | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort);
    try {
      if (signal.aborted) throw new Error("识别已取消");
      const views = attempt === 0 ? [dataUrl] : await recognitionViews(dataUrl);
      const response = await fetch(MINIMAX_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: MINIMAX_MODEL,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          reasoning_split: true,
          reasoning_effort: attempt === 0 ? "low" : "medium",
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                ...views.map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
                { type: "text", text: productionPrompt(platform, side) },
              ],
            },
          ],
        }),
      });
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
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
      const recognized = validateRecognition(JSON.parse(clean), side, true);
      if (!recognized.discountsComplete || !recognized.spendingComplete) {
        partial = recognized;
        if (attempt === 1) return recognized;
        throw new Error("金额区域未完整识别，请补充清晰截图");
      }
      return recognized;
    } catch (e) {
      lastError = e;
      if (signal.aborted) throw new Error("识别已取消");
      // Only retry once, with magnified views; ordinary successful transcription is one image/request.
      if (/模型服务请求失败（4|模型服务返回错误/.test((e as Error).message))
        throw e;
      if (attempt === 1) {
        if (partial) return partial;
        throw new Error(
          e instanceof SyntaxError
            ? "模型返回格式无效，请重试"
            : (e as Error).message === "This operation was aborted"
              ? "识别超时，请重试"
              : (e as Error).message,
        );
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  throw lastError;
}
