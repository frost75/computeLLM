import type { Field, OrderInput, Snapshot } from "./contracts";
import { money, nonnegative } from "./money";
import { spendingField, classify } from "./automation";

export const governmentLine = (name: string, category: string) =>
  ["governmentSubsidy", "nationalSubsidy"].includes(
    classify(name, category as never, "jd"),
  );

// 只读取原始证据和人工覆盖；不读取calculated，避免重算时把派生值再当输入。
export function rawValue(order: OrderInput, key: Field): number | null {
  const override = order.overrides[key];
  const parse = (v: string) =>
    key === "refundAmount" ? Math.abs(money(v)) : nonnegative(v);
  if (override !== undefined && override.trim() !== "") return parse(override);
  const rows = order.recognition?.spendingRows?.filter(
    (row) => row.field === key,
  );
  if (rows?.length) return rows.reduce((n, row) => n + parse(row.amount), 0);
  const legacy = (order.discounts ?? order.recognition?.discounts ?? []).filter(
    (row) => spendingField(row.name) === key,
  );
  if (legacy.length) return legacy.reduce((n, row) => n + parse(row.amount), 0);
  const field = order.recognition?.fields[key];
  if (field?.presence === "visible" && field.amount !== null)
    return parse(field.amount);
  return field?.presence === "absent" && key !== "orderAmount" ? 0 : null;
}
function ratio(raw: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || Number(raw) > 100)
    throw new Error("政府补贴比例应为0至100%，最多六位小数");
  const [whole, decimal = ""] = raw.split(".");
  return {
    numerator: BigInt(whole + decimal),
    denominator: 100n * 10n ** BigInt(decimal.length),
  };
}
const need = (n: number | null, name: string) => {
  if (n === null) throw new Error(`缺少${name}金额`);
  return n;
};
export interface Settlement {
  payment: number;
  subsidy: number;
  rate: number;
  rateLocked: boolean;
  subsidyObserved: boolean;
  base: number;
  source: string;
}
export function isSubsidyLocked(order: OrderInput): boolean {
  if (order.subsidyControl || order.overrides.subsidyAmount?.trim())
    return false;
  const rows = order.discounts ?? order.recognition?.discounts ?? [];
  const observed = rows
    .filter((row) => governmentLine(row.name, row.category))
    .reduce((n, row) => n + nonnegative(row.amount), 0);
  const f = order.recognition?.fields.subsidyAmount;
  return (
    observed > 0 ||
    (f?.presence === "visible" &&
      f.amount !== null &&
      nonnegative(f.amount) > 0)
  );
}
export function calculateSettlement(order: OrderInput): Settlement {
  const rows = (
    order.subsidyControl
      ? (order.recognition?.discounts ?? order.discounts ?? [])
      : (order.discounts ?? order.recognition?.discounts ?? [])
  ).filter((row) => governmentLine(row.name, row.category));
  const observed = rows.length
    ? rows.reduce((n, row) => n + nonnegative(row.amount), 0)
    : (() => {
        const f = order.recognition?.fields.subsidyAmount;
        return f?.presence === "visible" && f.amount !== null
          ? nonnegative(f.amount)
          : 0;
      })();
  const subsidyObserved = observed > 0;
  const control = order.subsidyControl;
  const manualSubsidy =
    control?.mode === "amount" && control.amount !== undefined
      ? nonnegative(control.amount)
      : order.overrides.subsidyAmount?.trim()
        ? nonnegative(order.overrides.subsidyAmount)
        : null;
  const rateMode = control?.mode === "rate";
  const unlocked = !!control || manualSubsidy !== null;
  const actualObserved = (() => {
    const f = order.recognition?.fields.actualPayment;
    return f?.presence === "visible" && f.amount !== null
      ? nonnegative(f.amount)
      : null;
  })();
  const actualOverrideValue = order.overrides.actualPayment?.trim()
    ? nonnegative(order.overrides.actualPayment)
    : null;
  const actualOverride =
    actualOverrideValue !== null && actualOverrideValue > 0
      ? actualOverrideValue
      : null;
  const included =
    order.subsidyInTotals === "included" ||
    (order.subsidyInTotals === "unknown" &&
      rows.some((row) =>
        ["receivable", "payment"].includes(row.sourceRegion ?? ""),
      ));
  let base: number;
  if (subsidyObserved && actualObserved !== null && actualObserved > 0)
    base = actualObserved + observed;
  else {
    const gross = rawValue(order, "orderAmount");
    const a =
      (gross === null || gross === 0) &&
      actualObserved !== null &&
      actualObserved > 0
        ? actualObserved
        : need(gross, "订单") -
          need(rawValue(order, "receivableDiscountTotal"), "应收优惠总额") -
          need(rawValue(order, "paymentDiscountTotal"), "支付优惠总额");
    if (a < 0) throw new Error("优惠总额超过订单金额");
    base = a + (subsidyObserved && included ? observed : 0);
  }
  let subsidy: number;
  if (subsidyObserved && !unlocked) subsidy = observed;
  else if (!rateMode && manualSubsidy !== null) subsidy = manualSubsidy;
  else {
    const r = ratio(control?.rate ?? order.subsidyRate ?? "10");
    subsidy = Number(
      (BigInt(base) * r.numerator + r.denominator / 2n) / r.denominator,
    );
  }
  let payment = actualOverride !== null ? actualOverride : base - subsidy;
  if (payment < 0) throw new Error("补贴金额超过补贴前支出");
  if (![base, subsidy, payment].every(Number.isSafeInteger))
    throw new Error("金额超出安全范围");
  return {
    payment,
    subsidy,
    base,
    subsidyObserved,
    rateLocked: subsidyObserved && !unlocked,
    rate:
      ((subsidyObserved && !unlocked) ||
        control?.mode === "amount" ||
        (manualSubsidy !== null && !rateMode)) &&
      payment + subsidy > 0
        ? (subsidy / (payment + subsidy)) * 100
        : Number(control?.rate ?? order.subsidyRate ?? "10"),
    source:
      actualOverride !== null
        ? "manual-payment"
        : subsidyObserved && !unlocked
          ? "observed-subsidy"
          : control?.mode === "amount" || (manualSubsidy !== null && !rateMode)
            ? "manual-subsidy"
            : "estimated-subsidy",
  };
}
export function materializeOrder(order: OrderInput): OrderInput {
  try {
    const result = calculateSettlement(order);
    let discounts = order.discounts;
    if (
      order.subsidyControl &&
      (discounts ?? order.recognition?.discounts)?.some((row) =>
        governmentLine(row.name, row.category),
      )
    ) {
      const source = discounts ?? order.recognition!.discounts;
      const govt = source.filter((row) =>
        governmentLine(row.name, row.category),
      );
      const total = govt.reduce((n, row) => n + nonnegative(row.amount), 0);
      let remaining = result.subsidy,
        count = govt.length;
      discounts = source.map((row) => {
        if (!governmentLine(row.name, row.category)) return row;
        const part =
          --count === 0
            ? remaining
            : total > 0
              ? Number(
                  (BigInt(result.subsidy) * BigInt(nonnegative(row.amount))) /
                    BigInt(total),
                )
              : 0;
        remaining -= part;
        return { ...row, amount: String(part / 1000) };
      });
    }
    return {
      ...order,
      ...(discounts ? { discounts } : {}),
      calculated: {
        actualPayment: String(result.payment / 1000),
        subsidyAmount: String(result.subsidy / 1000),
        rate: result.rate,
        rateLocked: result.rateLocked,
        subsidyObserved: result.subsidyObserved,
        base: result.base,
        source: result.source,
      },
    };
  } catch {
    return { ...order, calculated: undefined };
  }
}
export function materializeSnapshot(snapshot: Snapshot): Snapshot {
  if (snapshot.platform !== "jd") return snapshot;
  const materialize = (order: OrderInput) => {
    try {
      return materializeOrder(order);
    } catch {
      return { ...order, calculated: undefined };
    }
  };
  return {
    ...snapshot,
    original: materialize(snapshot.original),
    current: materialize(snapshot.current),
  };
}
export function setSubsidyAmount(
  order: OrderInput,
  amount: string,
): OrderInput {
  const overrides = { ...order.overrides };
  delete overrides.actualPayment;
  delete overrides.subsidyAmount;
  return materializeOrder({
    ...order,
    overrides,
    subsidyControl: { mode: "amount", amount },
    calculated: undefined,
  });
}
export function setSubsidyRate(order: OrderInput, rate: string): OrderInput {
  if (isSubsidyLocked(order)) return materializeOrder(order);
  try {
    if (calculateSettlement(order).rateLocked) return materializeOrder(order);
  } catch {
    /* incomplete order stays editable */
  }
  const overrides = { ...order.overrides };
  delete overrides.actualPayment;
  delete overrides.subsidyAmount;
  return materializeOrder({
    ...order,
    overrides,
    subsidyRate: rate,
    subsidyControl: { mode: "rate", rate },
    calculated: undefined,
  });
}
export const orderSnapshot = materializeOrder;
