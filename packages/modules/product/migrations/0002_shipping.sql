-- M01 0002：商品的运费归属（对齐淘宝发布页的「物流信息」区块）。
--
-- 淘宝上架商品时要选：运费模板，或「卖家承担运费」（包邮）。
-- 这里同样只给两个字段，不在商品上填金额 —— 金额属于模板，商品只负责"用哪套 + 是否包邮"。

ALTER TABLE product ADD COLUMN IF NOT EXISTS shipping_profile_id text;

-- 卖家包邮（淘宝的「卖家承担运费」）：该商品不产生运费。
ALTER TABLE product ADD COLUMN IF NOT EXISTS free_shipping boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN product.shipping_profile_id IS '运费模板 id；NULL = 用默认模板';
COMMENT ON COLUMN product.free_shipping IS '卖家包邮：该商品不产生运费，且金额不计入运费门槛';
