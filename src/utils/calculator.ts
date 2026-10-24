import { JdOrderData, TmallOrderData, CalculationResult, UserRole, Platform } from '../types/index.js';

export const calculateJdTotalDiscount = (order: JdOrderData): number => {
  return order.itemPromotion + order.itemDiscount + order.limitedTimeSubsidy + order.fullReduction + order.plusMemberDiscount + order.governmentSubsidy + order.nationalSubsidy + order.storeCoupon + order.normalCoupon + order.jointCoupon + order.bundleDiscount + order.otherDiscount;
};

export const calculateJdActualPayment = (order: JdOrderData): number => {
  return order.actualPayment + order.ecard + order.giftCard + order.paymentGift + order.tradeInSubsidy + order.tradeInOldMachine;
};

export const calculateTmallTotalDiscount = (order: TmallOrderData): number => {
  return order.storeDiscount + order.governmentSubsidy + order.officialLimitedTimeSubsidy + order.otherDiscount;
};

export const calculateTmallActualPayment = (order: TmallOrderData): number => {
  return order.actualPayment;
};

export const calculateRefund = (
  platform: Platform,
  originalOrder: JdOrderData | TmallOrderData,
  currentOrder: JdOrderData | TmallOrderData,
  userRole: UserRole
): CalculationResult => {
  let originalTotalDiscount: number;
  let currentTotalDiscount: number;
  let originalActualPayment: number;
  let currentActualPayment: number;

  if (platform === 'jd') {
    const jdOriginal = originalOrder as JdOrderData;
    const jdCurrent = currentOrder as JdOrderData;
    originalTotalDiscount = calculateJdTotalDiscount(jdOriginal);
    currentTotalDiscount = calculateJdTotalDiscount(jdCurrent);
    originalActualPayment = calculateJdActualPayment(jdOriginal);
    currentActualPayment = calculateJdActualPayment(jdCurrent);
  } else {
    const tmallOriginal = originalOrder as TmallOrderData;
    const tmallCurrent = currentOrder as TmallOrderData;
    originalTotalDiscount = calculateTmallTotalDiscount(tmallOriginal);
    currentTotalDiscount = calculateTmallTotalDiscount(tmallCurrent);
    originalActualPayment = calculateTmallActualPayment(tmallOriginal);
    currentActualPayment = calculateTmallActualPayment(tmallCurrent);
  }

  const discountDifference = currentTotalDiscount - originalTotalDiscount;
  const paymentDifference = originalActualPayment - currentActualPayment;

  const platformDiscount = paymentDifference - discountDifference;

  const actualDifference = Math.min(discountDifference, paymentDifference);

  let maxRefundableAmount: number;
  let beginnerRefund: number;
  let advancedRefund: number;
  let recommendation: string;
  let warningType: 'reject' | 'approve' | 'review' | undefined;

  const memberExtraLimit = 50;
  const leaderExtraLimit = 80;

  if (userRole === 'member') {
    let extraDiscount = 0;
    if (platformDiscount >= 0) {
      extraDiscount = platformDiscount < memberExtraLimit ? platformDiscount : memberExtraLimit;
    }
    maxRefundableAmount = memberExtraLimit;
    beginnerRefund = actualDifference > 0 ? actualDifference : 0;
    advancedRefund = beginnerRefund + extraDiscount;

    if (discountDifference < 0 && paymentDifference > 0) {
      warningType = 'reject';
      recommendation = `优惠差额为￥${discountDifference.toFixed(2)}（现订单优惠更少），原则上应拒绝退差。但平台优惠有￥${platformDiscount.toFixed(2)}，如用户强烈不满，可考虑给予￥${advancedRefund.toFixed(2)}关怀金。`;
    } else if (actualDifference <= 0) {
      warningType = 'approve';
      recommendation = `无需退差`;
    } else {
      let extraDesc = '';
      if (platformDiscount < 0) {
        extraDesc = `平台优惠￥${platformDiscount.toFixed(2)}<0，不给额外权限`;
      } else if (platformDiscount < memberExtraLimit) {
        extraDesc = `平台优惠￥${platformDiscount.toFixed(2)}<${memberExtraLimit} 元，按实际金额`;
      } else {
        extraDesc = `平台优惠￥${platformDiscount.toFixed(2)}≥${memberExtraLimit} 元，按上限 ${memberExtraLimit} 元`;
      }
      warningType = 'approve';
      recommendation = `实际差额为￥${actualDifference.toFixed(2)}，基础退差￥${beginnerRefund.toFixed(2)}。如用户不满可叠加额外优惠权限（${extraDesc}），进阶可退￥${advancedRefund.toFixed(2)}。`;
    }
  } else {
    let extraDiscount = 0;
    if (platformDiscount >= 0) {
      extraDiscount = platformDiscount < leaderExtraLimit ? platformDiscount : leaderExtraLimit;
    }
    maxRefundableAmount = leaderExtraLimit;
    beginnerRefund = actualDifference > 0 ? actualDifference : 0;
    advancedRefund = beginnerRefund + extraDiscount;

    if (discountDifference < 0 && paymentDifference > 0) {
      warningType = 'reject';
      recommendation = `优惠差额为￥${discountDifference.toFixed(2)}（现订单优惠更少），原则上应拒绝退差。但平台优惠有￥${platformDiscount.toFixed(2)}，如用户强烈不满，可考虑给予￥${advancedRefund.toFixed(2)}关怀金。`;
    } else if (actualDifference <= 0) {
      warningType = 'approve';
      recommendation = `无需退差`;
    } else {
      let extraDesc = '';
      if (platformDiscount < 0) {
        extraDesc = `平台优惠￥${platformDiscount.toFixed(2)}<0，不给额外权限`;
      } else if (platformDiscount < leaderExtraLimit) {
        extraDesc = `平台优惠￥${platformDiscount.toFixed(2)}<${leaderExtraLimit} 元，按实际金额`;
      } else {
        extraDesc = `平台优惠￥${platformDiscount.toFixed(2)}≥${leaderExtraLimit} 元，按上限 ${leaderExtraLimit} 元`;
      }
      warningType = 'approve';
      recommendation = `实际差额为￥${actualDifference.toFixed(2)}，基础退差￥${beginnerRefund.toFixed(2)}。如用户不满可叠加额外优惠权限（${extraDesc}），进阶可退￥${advancedRefund.toFixed(2)}。`;
    }
  }

  return {
    originalTotalDiscount,
    currentTotalDiscount,
    discountDifference,
    paymentDifference,
    platformDiscount,
    actualDifference,
    maxRefundableAmount,
    beginnerRefund,
    advancedRefund,
    recommendation,
    warningType
  };
};

export const formatCurrency = (value: number): string => {
  return `¥${value.toFixed(2)}`;
};

export const getDiscountColor = (value: number): string => {
  if (value < 0) return 'text-red-600';
  if (value > 0) return 'text-green-600';
  return 'text-gray-600';
};
