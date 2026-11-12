-- M06 0005：退款审核期的订单状态。
--
-- 淘宝的做法：买家申请退款后订单立即变「退款中」，卖家在此期间不能再发货，
-- 否则会出现「货已发出、钱也退了」。同意 → 已退款；拒绝/撤销 → 回到申请前的状态。
--
-- order_status_before 记录申请时的订单状态，用于拒绝/撤销时精确恢复
-- （已发货的订单回「已发货」，未发货的回「待发货」，不能一律回 paid）。

ALTER TABLE refund_request ADD COLUMN IF NOT EXISTS order_status_before text;

COMMENT ON COLUMN refund_request.order_status_before IS '申请退款时的订单状态，拒绝/撤销时据此恢复';
