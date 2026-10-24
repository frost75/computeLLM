-- 为京东订单添加限时补贴字段
ALTER TABLE public.refund_calculations_s_720986d7_5 
ADD COLUMN IF NOT EXISTS original_limited_time_subsidy DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_limited_time_subsidy DECIMAL(10,2) DEFAULT 0;
