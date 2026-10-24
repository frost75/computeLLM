import type { Platform, UserRole } from "../types";
import { JD_RULE } from "./config";
export type Presence = "visible" | "absent" | "unknown";
export interface Observation {
  amount: string | null;
  presence: Presence;
  evidence: string;
  confidence: number;
}
export const FIELD_LABELS = {
  actualPayment: "客户实付",
  orderAmount: "订单金额",
  dueAmount: "应收/待支付金额",
  paymentDiscountTotal: "支付优惠总额",
  receivableDiscountTotal: "应收优惠总额",
  freight: "运费",
  refundAmount: "价保/其他退款候选金额",
  ecard: "E卡",
  giftCard: "礼品卡",
  paymentGift: "支付有礼",
  tradeInSubsidy: "以旧换新补贴",
  tradeInOldMachine: "旧机抵扣",
  subsidyAmount: "单列补贴金额",
  platformCoupon: "已确认平台承担的券金额",
  discountTotal: "确认后的订单优惠合计",
  serviceFee: "服务费",
} as const;
export type Field = keyof typeof FIELD_LABELS;
export const CATEGORIES = {
  itemPromotion: "单品促销",
  itemDiscount: "单品折扣",
  limitedTimeSubsidy: "限时补贴",
  fullReduction: "满减满送",
  plusMemberDiscount: "PLUS会员折扣",
  governmentSubsidy: "政府补贴",
  nationalSubsidy: "国补",
  storeCoupon: "店铺东券",
  normalCoupon: "普通东券",
  jointCoupon: "联合优惠券",
  bundleDiscount: "套装优惠",
  otherDiscount: "临时优惠",
  storeDiscount: "店铺优惠",
  officialLimitedTimeSubsidy: "官方限时补贴",
  unknown: "待归类",
} as const;
export type Category = keyof typeof CATEGORIES;
export interface Discount {
  sourceRegion?: "receivable" | "payment" | "other";
  payerSource?: "evidence" | "inferred" | "manual" | "review";
  payerReason?: string;
  name: string;
  amount: string;
  category: Category;
  payer: "platform" | "store" | "unknown";
  evidence: string;
  confidence: number;
}
export interface Recognition {
  refundAlreadyIncluded?: boolean;
  extrasIncluded?: boolean;
  notices?: string[];
  raw?: unknown;
  spendingRows?: {
    sourceRegion?: "receivable" | "payment" | "other";
    name: string;
    amount: string;
    field: Field;
    evidence: string;
  }[];
  fields: Partial<Record<Field, Observation>>;
  discounts: Discount[];
  paymentStatus: "paid" | "unpaid" | "unknown";
  subsidyInTotals: "included" | "excluded" | "unknown";
  discountsComplete: boolean;
  spendingComplete: boolean;
  exceptions: string[];
  scopeConfirmed: boolean;
  metadata: {
    provider: string;
    model: string;
    adapterVersion: string;
    promptVersion: string;
    time: string;
  };
}
export interface OrderInput {
  subsidyControl?: { mode: "amount" | "rate"; amount?: string; rate?: string };
  calculated?: {
    actualPayment: string;
    subsidyAmount: string;
    rate: number;
    rateLocked: boolean;
    subsidyObserved: boolean;
    base: number;
    source: string;
  };
  automatic?: boolean;
  recognitionError?: string;
  imageId?: string;
  recognition?: Recognition;
  overrides: Partial<Record<Field, string>>;
  discounts?: Discount[];
  paymentStatus: "paid" | "unpaid" | "unknown";
  subsidyInTotals: "included" | "excluded" | "unknown";
  refundStatus: "returned" | "none" | "unknown";
  refundAlreadyIncluded: boolean;
  extrasIncluded: boolean;
  platformConfirmed: boolean;
  discountsConfirmed: boolean;
  spendingConfirmed: boolean;
  scopeConfirmed: boolean;
  subsidyRate: string;
}
export interface Result {
  ruleVersion: string;
  ruleConfig?: unknown;
  status: "refund" | "reject" | "none";
  base: number;
  extra: number | null;
  total: number | null;
  customerText: string;
  careText: string | null;
  internal: string[];
  basis: Record<string, number | null>;
}
export interface Snapshot {
  platform: Platform;
  role: UserRole;
  original: OrderInput;
  current: OrderInput;
  result: Result | null;
  comparisonConfirmed?: boolean;
  aiReview?: {
    status: "running" | "done" | "failed" | "stale";
    summary: string;
    responseText: string;
    changes: string[];
    actions?: string[];
    warnings: {
      side?: "original" | "current";
      field?: Field;
      index?: number;
      message: string;
    }[];
    elapsedMs?: number;
    time: string;
  };
}
export interface Revision {
  id: string;
  parentId: string | null;
  time: string;
  snapshot: Snapshot;
}
export interface CaseFile {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  draft: Snapshot;
  revisions: Revision[];
  baseRevision: string | null;
  chatThreads?: Record<string, CaseChatThread>;
}
export interface CaseChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  context?: Snapshot;
}
export interface CaseChatThread {
  messages: CaseChatMessage[];
  error?: string;
}
export const newOrder = (): OrderInput => ({
  overrides: {},
  paymentStatus: "unknown",
  subsidyInTotals: "unknown",
  refundStatus: "unknown",
  refundAlreadyIncluded: false,
  extrasIncluded: false,
  platformConfirmed: false,
  discountsConfirmed: false,
  spendingConfirmed: false,
  scopeConfirmed: false,
  subsidyRate: String(JD_RULE.defaultSubsidyRate),
});
export const newCase = (): CaseFile => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: new Date().toLocaleString("zh-CN"),
    createdAt: now,
    updatedAt: now,
    draft: {
      platform: "jd",
      role: "member",
      original: newOrder(),
      current: newOrder(),
      result: null,
    },
    revisions: [],
    baseRevision: null,
  };
};
