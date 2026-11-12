-- M06 0003：商家备注（淘宝订单详情里每条订单都有「商家备注」）。
--
-- 客服/发货要留内部说明：客户要求、特殊包装、售后约定。
-- 与顾客留言分开存：merchant_note 只在后台可见，不下发到店面。

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS merchant_note text;

COMMENT ON COLUMN "order".merchant_note IS '商家内部备注，仅后台可见';
