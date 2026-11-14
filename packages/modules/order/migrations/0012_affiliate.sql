-- M05 0012：订单归因（分销，ADR-101）。
--
-- affiliate_id = 下单时携带的有效推广码对应的推广员（customer_id）。
-- 只记归属，不影响金额：佣金由 promotion 模块在订单完成时另行计提。
-- 为空 = 自然流量。

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS affiliate_id text;

CREATE INDEX IF NOT EXISTS idx_order_affiliate ON "order" (affiliate_id);

COMMENT ON COLUMN "order".affiliate_id IS '推广员 id（分销归因，ADR-101）；null = 自然流量';
