export type Platform = 'jd' | 'tmall';
export type UserRole = 'member' | 'leader';

export interface JdOrderData {
  itemPromotion: number;
  itemDiscount: number;
  limitedTimeSubsidy: number;
  fullReduction: number;
  plusMemberDiscount: number;
  governmentSubsidy: number;
  nationalSubsidy: number;
  storeCoupon: number;
  normalCoupon: number;
  jointCoupon: number;
  bundleDiscount: number;
  otherDiscount: number;
  ecard: number;
  giftCard: number;
  paymentGift: number;
  tradeInSubsidy: number;
  tradeInOldMachine: number;
  actualPayment: number;
}

export interface TmallOrderData {
  storeDiscount: number;
  governmentSubsidy: number;
  officialLimitedTimeSubsidy: number;
  otherDiscount: number;
  serviceFee: number;
  actualPayment: number;
}

export interface CalculationResult {
  originalTotalDiscount: number;
  currentTotalDiscount: number;
  discountDifference: number;
  paymentDifference: number;
  platformDiscount: number;
  actualDifference: number;
  maxRefundableAmount: number;
  beginnerRefund: number;
  advancedRefund: number;
  recommendation: string;
  warningType?: 'reject' | 'approve' | 'review';
}
