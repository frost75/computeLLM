-- 添加支付有礼字段到京东订单数据
ALTER TABLE refund_calculations_s_720986d7_5 
ADD COLUMN IF NOT EXISTS original_payment_gift NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_payment_gift NUMERIC(10,2) DEFAULT 0;