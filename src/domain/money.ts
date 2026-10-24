// 所有业务计算使用整数千分元；只在展示时转为元。
export function money(raw: string): number {
  const value = raw.trim().replace(/[¥￥,，\s]/g, "");
  if (!/^-?\d+(\.\d{1,3})?$/.test(value))
    throw new Error("金额须为最多三位小数的数字");
  const negative = value.startsWith("-");
  const [a, b = ""] = value.replace("-", "").split(".");
  const result = Number(a) * 1000 + Number(b.padEnd(3, "0"));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 1_000_000_000_000)
    throw new Error("金额超出范围");
  return negative ? -result : result;
}
export const yuan = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 1000);
export function nonnegative(raw: string): number {
  const n = money(raw);
  if (n < 0) throw new Error("金额不能为负数（退款候选可填负号）");
  return n;
}
