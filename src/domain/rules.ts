import {
  CATEGORIES,
  type Category,
  type OrderInput,
  type Snapshot,
  type Result,
  type Field,
} from "./contracts";
import { nonnegative, yuan } from "./money";
import { JD_RULE, TMALL_RULE } from "./config";
import { calculateSettlement, rawValue, governmentLine } from "./settlement";
import {
  platformAmount,
  attention,
  normalizeDiscount,
  spendingField,
} from "./automation";
export { JD_RULE } from "./config";
const tmCategories: Category[] = [
  "storeDiscount",
  "governmentSubsidy",
  "officialLimitedTimeSubsidy",
  "otherDiscount",
];
export function value(order: OrderInput, key: Field): number | null {
  if (key === "actualPayment" || key === "subsidyAmount") {
    try {
      const settled = calculateSettlement(order);
      return key === "actualPayment" ? settled.payment : settled.subsidy;
    } catch {
      /* editable incomplete input falls back to original evidence */
    }
  }
  return rawValue(order, key);
}
function sum(items: number[]) {
  const n = items.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(n)) throw new Error("金额超出安全范围");
  return n;
}
function resolve(order: OrderInput, platform: "jd" | "tmall", side: string) {
  const get = (key: Field) => rawValue(order, key);
  const lines = (order.discounts ?? order.recognition?.discounts ?? [])
    .filter((row) => !spendingField(row.name))
    .map((row) => normalizeDiscount(row, platform));
  if (platform === "tmall") {
    if (!order.scopeConfirmed && !order.automatic)
      throw new Error(`${side}：请确认订单适用范围`);
    if (order.recognition?.exceptions.length)
      throw new Error(
        `${side}：截图发现${order.recognition.exceptions.join("、")}`,
      );
    if (!order.discountsConfirmed || !order.spendingConfirmed)
      throw new Error(`${side}：请核对优惠与支付项目`);
    const payment = get("actualPayment");
    if (payment === null) throw new Error(`${side}：缺少实付款`);
    const explicit = get("discountTotal");
    if (
      explicit === null &&
      !lines.length &&
      (get("receivableDiscountTotal") ?? 0) > 0
    )
      throw new Error(`${side}：缺少优惠明细`);
    if (
      explicit === null &&
      lines.some((row) => !tmCategories.includes(row.category))
    )
      throw new Error(`${side}：优惠明细有待归类项目`);
    const netPayment = payment - (get("serviceFee") ?? 0);
    if (netPayment < 0) throw new Error(`${side}：实付扣除服务费后为负`);
    return {
      discount: explicit ?? sum(lines.map((row) => nonnegative(row.amount))),
      payment: netPayment,
      platformCoupon: platformAmount({ ...order, discounts: lines }),
      estimatedSubsidy: 0,
    };
  }
  const settlement = calculateSettlement(order);
  let discount = sum(
    lines
      .filter((row) => !governmentLine(row.name, row.category))
      .map((row) => {
        const amount = nonnegative(row.amount);
        return row.payer === "store" ? amount : 0;
      }),
  );
  if (!lines.length) discount = get("discountTotal") ?? 0;
  const governments = lines.filter((row) =>
    governmentLine(row.name, row.category),
  );
  const govTotal = sum(governments.map((row) => nonnegative(row.amount)));
  const merchantGov = sum(
    governments
      .filter((row) => row.payer === "store")
      .map((row) => nonnegative(row.amount)),
  );
  const govContribution = !governments.length
    ? settlement.subsidy
    : govTotal > 0
      ? Number(
          (BigInt(settlement.subsidy) * BigInt(merchantGov) +
            BigInt(Math.floor(govTotal / 2))) /
            BigInt(govTotal),
        )
      : governments.some((row) => row.payer === "store")
        ? settlement.subsidy
        : 0;
  discount += govContribution;
  const extras = sum(
    (
      [
        "ecard",
        "giftCard",
        "paymentGift",
        "tradeInSubsidy",
        "tradeInOldMachine",
      ] as Field[]
    ).map((key) => get(key) ?? 0),
  );
  const refund = get("refundAmount") ?? 0;
  const payment =
    settlement.payment + extras - (order.refundAlreadyIncluded ? 0 : refund);
  if (payment < 0) throw new Error(`${side}：净支出为负，请核对退款或金额`);
  return {
    discount,
    payment,
    platformCoupon: platformAmount({ ...order, discounts: lines }),
    estimatedSubsidy: settlement.subsidyObserved ? 0 : settlement.subsidy,
  };
}
export function evaluate(input: Snapshot): {
  result: Result | null;
  issues: string[];
} {
  try {
    const a = resolve(input.original, input.platform, "原订单");
    const b = resolve(input.current, input.platform, "现订单");
    for (const field of ["freight", "orderAmount"] as Field[]) {
      const x = value(input.original, field),
        y = value(input.current, field);
      if (input.platform === "tmall" && x !== null && y !== null && x !== y)
        throw new Error(
          `${field === "freight" ? "运费" : "订单金额"}发生变化，当前规则未覆盖，请人工处理`,
        );
    }
    const d = b.discount - a.discount,
      p = a.payment - b.payment,
      base = Math.max(0, Math.min(d, p)),
      residual = p - d;
    const config = input.platform === "jd" ? JD_RULE : TMALL_RULE;
    // 天猫保持原差额口径；京东仅采用独立确认的平台券。
    const q =
      input.platform === "jd"
        ? a.platformCoupon !== null && b.platformCoupon !== null
          ? a.platformCoupon - b.platformCoupon
          : null
        : residual;
    // 京东平台优惠不退，不以平台券差额自动叠加关怀。
    const extra =
      input.platform === "jd"
        ? 0
        : q === null
          ? null
          : Math.min(Math.max(q, 0), config.caps[input.role]);
    const status = d < 0 && p > 0 ? "reject" : base <= 0 ? "none" : "refund";
    const customerText =
      status === "refund"
        ? `您好，现订单享受的${input.platform === "jd" ? "商家优惠" : "优惠"}有所增加，核对两笔订单的优惠及付款金额后，本次可为您退还差价${yuan(base)}元。`
        : status === "reject"
          ? "您好，核对后，现订单的商家优惠没有增加，本次不符合退差条件，暂时没有可退的差价。"
          : "您好，核对两笔订单的商家优惠和实际支出后，本次没有产生可退的差价。";
    return {
      issues: [],
      result: {
        ruleVersion: config.version,
        ruleConfig: { ...config },
        status,
        base,
        extra,
        total: extra === null ? null : base + extra,
        customerText,
        careText:
          extra !== null && extra > 0
            ? `您好，本次可提供${yuan(extra)}元关怀方案${base > 0 ? `，加上退差价${yuan(base)}元，合计${yuan(base + extra)}元` : ""}。`
            : null,
        internal: [
          ...attention(input.original),
          ...attention(input.current),
          ...((["freight", "orderAmount"] as Field[]).some(
            (k) =>
              value(input.original, k) === null ||
              value(input.current, k) === null,
          )
            ? [
                "截图中部分订单金额或运费未展示，未发现明确变化线索；如实际存在变化，请勿采用本结果。",
              ]
            : []),
          input.platform === "jd"
            ? "平台承担的优惠不计入可退优惠，不自动叠加平台券关怀；如有其他诉求，请按实际情况另行处理。"
            : extra === null
              ? "平台券承担来源未确认：基础金额可核对，暂不计算额外关怀。"
              : `额外关怀参考${yuan(extra)}元，岗位额外额度上限${yuan(config.caps[input.role])}元。需实际确认采用关怀方案后，再使用对应用户话术。`,
          "未归因差额仅作核对，不视为平台券。",
        ],
        basis: {
          原订单优惠: a.discount,
          现订单优惠: b.discount,
          原订单净支出: a.payment,
          现订单净支出: b.payment,
          优惠差额: d,
          支出差额: p,
          已确认平台券差额: q,
          未归因差额: residual,
          原订单估算补贴: a.estimatedSubsidy,
          现订单估算补贴: b.estimatedSubsidy,
        },
      },
    };
  } catch (e) {
    return { result: null, issues: [(e as Error).message] };
  }
}
export { CATEGORIES };
