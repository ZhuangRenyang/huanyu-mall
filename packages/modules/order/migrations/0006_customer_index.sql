-- M06 0006：按顾客查订单的索引。
--
-- 后台「客户列表」要显示每个客户的订单数与累计消费，店面「我的订单」也按 customer_id 查。
-- 没有索引时这两处都是全表扫描；数据量上千单后列表会明显变慢。

CREATE INDEX IF NOT EXISTS idx_order_customer_created
  ON "order" (customer_id, created_at DESC);
