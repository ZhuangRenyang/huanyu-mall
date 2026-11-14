-- M05 0010：换货（ADR-090）。
--
-- 售后第三种类型。换货不动钱：顾客把货寄回、商家把换出的货发出，
-- 全程没有任何资金流动，所以单据上不存 refund_id，也不走退款 workflow。
--
-- 换出商品在「同意换货」时按申请单 id 预留库存（inventory.allocateAndReserve 的
-- orderId 传申请单 id），商家发出时 commit —— 和订单发货同一条库存链路，
-- 只是租约键换成了申请单，避免和原订单的预留混在一起。

ALTER TABLE refund_request
  ADD COLUMN IF NOT EXISTS exchange_variant_id text,
  ADD COLUMN IF NOT EXISTS exchange_quantity integer,
  ADD COLUMN IF NOT EXISTS exchange_label text,
  ADD COLUMN IF NOT EXISTS exchange_carrier text,
  ADD COLUMN IF NOT EXISTS exchange_tracking_number text,
  ADD COLUMN IF NOT EXISTS exchange_shipped_at timestamptz;

COMMENT ON COLUMN refund_request.exchange_variant_id IS '换货目标规格 id（同意换货时预留库存的键，ADR-090）';
COMMENT ON COLUMN refund_request.exchange_quantity IS '换货数量（默认 1，ADR-090）';
COMMENT ON COLUMN refund_request.exchange_label IS '换货目标快照文案（商品名/规格），规格删了单据仍可读';
COMMENT ON COLUMN refund_request.exchange_carrier IS '商家换出物流公司（ADR-090）';
COMMENT ON COLUMN refund_request.exchange_tracking_number IS '商家换出物流单号（ADR-090）';
COMMENT ON COLUMN refund_request.exchange_shipped_at IS '换出时间（ADR-090）';
