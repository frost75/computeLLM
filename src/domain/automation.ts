import {
  CATEGORIES,
  type OrderInput,
  type Recognition,
  type Field,
  type Discount,
} from "./contracts";
import { money } from "./money";
const aliases: [RegExp, Discount["category"]][] = [
  [/单品折扣/, "itemDiscount"],
  [/单品促销/, "itemPromotion"],
  [/官方限时补贴/, "officialLimitedTimeSubsidy"],
  [/限时补贴/, "limitedTimeSubsidy"],
  [/满减|满送/, "fullReduction"],
  [/PLUS|plus/, "plusMemberDiscount"],
  [/政府补贴/, "governmentSubsidy"],
  [/国补/, "nationalSubsidy"],
  [/店铺东券/, "storeCoupon"],
  [/普通东券/, "normalCoupon"],
  [/联合优惠券/, "jointCoupon"],
  [/套装优惠/, "bundleDiscount"],
  [/临时优惠/, "otherDiscount"],
  [/店铺优惠|店铺券/, "storeDiscount"],
];
export const refundLabel = (label: string) =>
  /价保|保价|费用项[加价][宝宝保]|已退差|退差退款/.test(label);
// 支出项目的身份由业务口径决定，不能随模型建议的承担方变化。
export const spendingField = (name: string): Field | null =>
  /E\s*卡|e\s*卡/.test(name)
    ? "ecard"
    : /礼品卡/.test(name)
      ? "giftCard"
      : /支付有礼/.test(name)
        ? "paymentGift"
        : /旧机抵扣/.test(name)
          ? "tradeInOldMachine"
          : /以旧换新.*补贴/.test(name)
            ? "tradeInSubsidy"
            : null;
export function normalizeDiscount(line: Discount, platform: string): Discount {
  const category = classify(line.name, line.category, platform);
  if (
    platform === "jd" &&
    ["governmentSubsidy", "nationalSubsidy"].includes(category) &&
    !["manual", "review"].includes(line.payerSource ?? "")
  )
    return {
      ...line,
      category,
      payer: "store",
      payerSource: "evidence",
      confidence: 1,
      payerReason: "业务默认政府/国家补贴按商家承担参与退差，可手动切换",
    };
  if (
    platform === "jd" &&
    category === "jointCoupon" &&
    !["manual", "review"].includes(line.payerSource ?? "")
  ) {
    const merchant = [10000, 12000].includes(money(line.amount));
    return {
      ...line,
      category,
      payer: merchant ? "store" : "platform",
      payerSource: "evidence",
      confidence: 1,
      payerReason:
        "按业务规则：联合优惠券10元或12元为商家承担，其他金额为平台承担",
    };
  }
  return { ...line, category };
}
export function classify(
  name: string,
  fallback: Discount["category"],
  platform: string,
) {
  let found = aliases.find(([pattern]) => pattern.test(name))?.[1] ?? fallback;
  if (platform === "tmall" && found === "nationalSubsidy")
    found = "governmentSubsidy";
  return found;
}
export const couponLine = (line: Discount) =>
  line.category === "jointCoupon" ||
  line.category === "normalCoupon" ||
  /平台券|京东券/.test(line.name);
export const comparisonExceptions = (exceptions: string[], side: string) =>
  exceptions.filter(
    (reason) =>
      !(
        ["current", "现订单"].includes(side) &&
        /取消/.test(reason) &&
        !/退款|退货|多商品|多数量/.test(reason)
      ),
  );
// 兼容旧档：旧归一曾删除现单取消线索，原始识别回执仍保留完整证据。
export function observedExceptions(recognition?: Recognition): string[] {
  const raw = recognition?.raw;
  const original =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "exceptions" in raw &&
    Array.isArray(raw.exceptions)
      ? raw.exceptions.filter(
          (reason): reason is string => typeof reason === "string",
        )
      : [];
  return [...new Set([...(recognition?.exceptions ?? []), ...original])];
}
export function automaticOrder(
  recognition: Recognition,
  imageId: string | undefined,
  side: string,
  platform: string,
): OrderInput {
  const obs = (k: Field) => {
    const v = recognition.fields[k];
    return v?.presence === "visible" && v.amount !== null
      ? money(v.amount)
      : v?.presence === "absent"
        ? 0
        : null;
  };
  const lines = recognition.discounts
    .filter((line) => !spendingField(line.name))
    .map((line) => normalizeDiscount(line, platform));
  const status =
    recognition.paymentStatus === "unknown"
      ? side === "original"
        ? "paid"
        : "unpaid"
      : recognition.paymentStatus;
  const notices = [...(recognition.notices ?? [])];
  if (recognition.paymentStatus === "unknown")
    notices.push(
      side === "original" ? "按原订单已付款场景识别" : "按现订单待付款场景识别",
    );
  const recognizedRefund = obs("refundAmount");
  const refunded = recognizedRefund !== null && Math.abs(recognizedRefund) > 0;
  const spendingRows = [...(recognition.spendingRows ?? [])];
  for (const row of recognition.discounts) {
    const field = spendingField(row.name);
    if (
      field &&
      !spendingRows.some(
        (r) =>
          r.field === field && r.name === row.name && r.amount === row.amount,
      )
    )
      spendingRows.push({
        name: row.name,
        amount: row.amount,
        field,
        evidence: row.evidence,
      });
  }
  const normalized: Recognition = {
    ...recognition,
    spendingRows,
    discounts: lines,
    notices,
    exceptions: observedExceptions(recognition),
  };
  // 完整区域未发现的可选支出项目按零；必要实付/应付与总额仍保留缺失状态。
  const optional: Field[] = [
    "refundAmount",
    "ecard",
    "giftCard",
    "paymentGift",
    "tradeInSubsidy",
    "tradeInOldMachine",
    "serviceFee",
  ];
  if (recognition.spendingComplete)
    for (const k of optional)
      if (!normalized.fields[k] || normalized.fields[k]?.presence === "unknown")
        normalized.fields = {
          ...normalized.fields,
          [k]: {
            amount: null,
            presence: "absent",
            evidence: "完整金额区域未见该项目",
            confidence: 1,
          },
        };
  return {
    automatic: true,
    imageId,
    recognition: normalized,
    overrides: {},
    discounts: lines,
    paymentStatus: status,
    subsidyInTotals: recognition.subsidyInTotals,
    refundStatus: refunded ? "returned" : "none",
    refundAlreadyIncluded: !!recognition.refundAlreadyIncluded,
    extrasIncluded: !!recognition.extrasIncluded,
    platformConfirmed: !lines.some(
      (v) => couponLine(v) && v.payer === "unknown",
    ),
    discountsConfirmed: recognition.discountsComplete,
    spendingConfirmed: recognition.spendingComplete,
    scopeConfirmed: !(
      platform === "jd"
        ? comparisonExceptions(normalized.exceptions, side)
        : normalized.exceptions
    ).length,
    subsidyRate: "10",
  };
}
export function platformAmount(order: OrderInput): number | null {
  const rows = order.discounts ?? order.recognition?.discounts ?? [];
  if (rows.some((v) => couponLine(v) && v.payer === "unknown")) return null;
  return rows
    .filter((v) => couponLine(v) && v.payer === "platform")
    .reduce((n, v) => n + Math.abs(money(v.amount)), 0);
}
export function attention(order: OrderInput): string[] {
  const notices = [...(order.recognition?.notices ?? [])];
  for (const row of order.discounts ?? order.recognition?.discounts ?? [])
    if (row.payerSource === "inferred" || row.confidence < 0.75)
      notices.push(
        `${row.name}：${row.payerReason || "承担方为自动判断，可点选切换"}`,
      );
  return [...new Set(notices)];
}
export { CATEGORIES };
