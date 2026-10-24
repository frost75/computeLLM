import {
  CATEGORIES,
  type Category,
  type OrderInput,
  type Snapshot,
  type Result,
  type Field,
} from "./contracts";
import { money, nonnegative, yuan } from "./money";
import { JD_RULE, TMALL_RULE } from "./config";
import { platformAmount, attention, normalizeDiscount, spendingField, comparisonExceptions } from "./automation";
export { JD_RULE } from "./config";
const jdCategories: Category[] = [
  "itemPromotion",
  "itemDiscount",
  "limitedTimeSubsidy",
  "fullReduction",
  "plusMemberDiscount",
  "governmentSubsidy",
  "nationalSubsidy",
  "storeCoupon",
  "normalCoupon",
  "jointCoupon",
  "bundleDiscount",
  "otherDiscount",
];
const tmCategories: Category[] = [
  "storeDiscount",
  "governmentSubsidy",
  "officialLimitedTimeSubsidy",
  "otherDiscount",
];
export function value(order: OrderInput, key: Field): number | null {
  const override = order.overrides[key];
  if (override !== undefined && override.trim() !== "")
    return key === "refundAmount"
      ? Math.abs(money(override))
      : nonnegative(override);
  const rows = order.recognition?.spendingRows?.filter((r) => r.field === key);
  if (rows?.length) return sum(rows.map((r) => nonnegative(r.amount)));
  const legacyRows = (order.discounts ?? order.recognition?.discounts ?? []).filter(r => spendingField(r.name) === key);
  if (legacyRows.length) return sum(legacyRows.map(r => nonnegative(r.amount)));
  const observed = order.recognition?.fields[key];
  if (observed?.presence === "absent") return 0;
  if (observed?.presence === "visible" && observed.amount !== null)
    return key === "refundAmount"
      ? Math.abs(money(observed.amount))
      : nonnegative(observed.amount);
  return null;
}
function required(n: number | null, label: string): number {
  if (n === null) throw new Error(`请确认${label}`);
  return n;
}
function sum(items: number[]): number {
  const n = items.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(n)) throw new Error("金额超出安全范围");
  return n;
}
function resolve(order: OrderInput, platform: "jd" | "tmall", side: string) {
  const get = (key: Field) => value(order, key);
  if (!order.scopeConfirmed && !order.automatic)
    throw new Error(
      `${side}：请确认订单属于单商品单数量、正常状态，且没有未覆盖例外`,
    );
  const exceptions = platform === "jd" ? comparisonExceptions(order.recognition?.exceptions ?? [], side) : order.recognition?.exceptions ?? [];
  if (exceptions.length)
    throw new Error(
      `${side}：截图发现${exceptions.join("、")}，请人工处理；确认误识别后可清除线索`,
    );
  if (!order.discountsConfirmed)
    throw new Error(`${side}：请核对优惠明细是否完整`);
  if (!order.spendingConfirmed)
    throw new Error(`${side}：请核对支出项目是否完整`);
  const lines = (order.discounts ?? order.recognition?.discounts ?? [])
    .filter(line => !spendingField(line.name))
    .map(line => normalizeDiscount(line, platform));
  const allowed = platform === "jd" ? jdCategories : tmCategories;
  const explicit = get("discountTotal");
  if (
    explicit === null &&
    !lines.length &&
    (get("receivableDiscountTotal") ?? 0) > 0
  )
    throw new Error(
      `${side}：有优惠总额但未识别到完整明细，请核对后填写确认优惠合计`,
    );
  if (
    explicit === null &&
    lines.some((l) => l.category === "unknown" || !allowed.includes(l.category))
  )
    throw new Error(`${side}：优惠明细有待归类项目`);
  let jointTaken = false;
  let discount =
    explicit ??
    sum(
      lines.map((l) => {
        const n = nonnegative(l.amount);
        if (platform === "jd" && l.category === "jointCoupon") {
          if (jointTaken || l.payer !== "store") return 0;
          jointTaken = true;
        }
        return n;
      }),
    );
  let payment = get("actualPayment");
  const usesActualPayment = payment !== null && payment > 0;
  let estimatedSubsidy = 0;
  if (platform === "tmall") {
    payment = required(payment, `${side}实付款`) - (get("serviceFee") ?? 0);
  } else {
    // 现单按完成付款后的支出比较。零元实付不代表免费；兼容旧记录的状态字段。
    if (payment === null || payment === 0) {
      const due = get("dueAmount");
      payment = due !== null && due > 0 ? due : null;
    }
    // 应收金额可能只是商品应收，尚未抵扣支付优惠；通过总额等式识别这一口径。
    if (!usesActualPayment && payment !== null && payment === get("dueAmount")) {
      const gross = get("orderAmount"), receivable = get("receivableDiscountTotal"), payDiscount = get("paymentDiscountTotal");
      if (gross !== null && receivable !== null && payDiscount !== null && payDiscount > 0 && payment === gross - receivable)
        payment -= payDiscount;
    }
    if (payment === null) {
      const a =
        required(get("orderAmount"), `${side}订单金额`) -
        required(get("paymentDiscountTotal"), `${side}支付优惠总额`) -
        required(get("receivableDiscountTotal"), `${side}应收优惠总额`);
      if (a < 0) throw new Error(`${side}：优惠总额超过订单金额，请核对`);
      const subsidyState =
        order.subsidyInTotals === "unknown" && order.automatic
          ? lines.some((l) =>
              ["governmentSubsidy", "nationalSubsidy"].includes(l.category),
            )
            ? "included"
            : "excluded"
          : order.subsidyInTotals;
      if (subsidyState === "unknown")
        throw new Error(`${side}：请确认补贴是否已包含在优惠总额中`);
      if (subsidyState === "included") payment = a;
      else {
        const subsidy = required(
          get("subsidyAmount") ?? (order.automatic ? 0 : null),
          `${side}补贴金额；确认未显示时填0，才按比例估算`,
        );
        if (subsidy > 0) {
          payment = a - subsidy;
          if (
            explicit === null &&
            !lines.some((l) =>
              ["governmentSubsidy", "nationalSubsidy"].includes(l.category),
            )
          )
            discount += subsidy;
        } else {
          if (!/^\d+(\.\d{1,2})?$/.test(order.subsidyRate))
            throw new Error(`${side}：补贴比例格式不正确`);
          const rate = Math.round(Number(order.subsidyRate) * 100);
          if (rate < 0 || rate > 10000)
            throw new Error(`${side}：补贴比例应为0至100%`);
          // 比例拆分按千分元四舍五入；补贴与实付互补，避免重复舍入。
          estimatedSubsidy = Number(
            (BigInt(a) * BigInt(rate) + 5000n) / 10000n,
          );
          payment = a - estimatedSubsidy;
          if (
            explicit !== null ||
            lines.some((l) =>
              ["governmentSubsidy", "nationalSubsidy"].includes(l.category),
            )
          )
            throw new Error(
              `${side}：估算补贴与已录入的补贴/优惠合计可能重复，请核对`,
            );
          discount += estimatedSubsidy;
        }
      }
    }
    if (order.refundStatus === "unknown")
      throw new Error(`${side}：请确认价保等退款是否实际退回`);
    const refund =
      order.refundStatus === "returned"
        ? required(get("refundAmount"), `${side}已退回金额`)
        : 0;
    payment -= order.refundAlreadyIncluded ? 0 : refund;
    if (usesActualPayment || !order.extrasIncluded) {
      payment += sum(
        (
          [
            "ecard",
            "giftCard",
            "paymentGift",
            "tradeInSubsidy",
            "tradeInOldMachine",
          ] as Field[]
        ).map((k) => {
          const n = get(k);
          if (n === null && !order.spendingConfirmed)
            throw new Error(`${side}：请核对支出项目`);
          return n ?? 0;
        }),
      );
    }
  }
  if (payment < 0)
    throw new Error(`${side}：净支出为负，请核对退款、补贴及重复计入`);
  const platformCoupon =
    order.automatic && order.overrides.platformCoupon === undefined
      ? platformAmount({ ...order, discounts: lines })
      : order.platformConfirmed
        ? required(
            get("platformCoupon"),
            `${side}已确认平台承担的券金额（无则填0）`,
          )
        : null;
  return { discount, payment, platformCoupon, estimatedSubsidy };
}
export function evaluate(input: Snapshot): {
  result: Result | null;
  issues: string[];
} {
  try {
    const a = resolve(input.original, input.platform, "原订单");
    const b = resolve(input.current, input.platform, "现订单");
    if (
      input.platform === "jd" &&
      !input.comparisonConfirmed &&
      !input.original.automatic &&
      !input.current.automatic &&
      (["freight", "orderAmount"] as Field[]).some(
        (k) =>
          value(input.original, k) === null || value(input.current, k) === null,
      )
    )
      throw new Error(
        "两单订单金额或运费未显示完整，请核对是否相同后确认可比性",
      );
    for (const field of ["freight", "orderAmount"] as Field[]) {
      const x = value(input.original, field),
        y = value(input.current, field);
      if (x !== null && y !== null && x !== y)
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
    const extra =
      q === null ? null : Math.min(Math.max(q, 0), config.caps[input.role]);
    const status = d < 0 && p > 0 ? "reject" : base <= 0 ? "none" : "refund";
    const customerText =
      status === "refund"
        ? `您好，核对两笔订单的优惠和实际支出后，本次可退差价为${yuan(base)}元。现订单的优惠比原订单增加${yuan(d)}元，对比支出减少${yuan(p)}元，本次按两项差额中较小的金额办理退差。${input.original.paymentStatus === "unpaid" || input.current.paymentStatus === "unpaid" ? "其中，未付款订单使用完成付款时的应付金额进行对比。" : ""}`
        : status === "reject"
          ? "您好，核对后，现订单的订单优惠比原订单少，本次对比不符合退差条件，因此没有可退的差价。"
          : "您好，核对两笔订单的优惠和实际支出后，本次没有产生可退的差价。";
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
          extra === null
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
