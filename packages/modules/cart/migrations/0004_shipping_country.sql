-- M04 Cart 0004_shipping_country：购物车记住「收货国家」。
--
-- 为什么必须有这一列：税与运费都按收货国家算，而国家原来只能从
-- 查询参数(?country=)或下单请求体里拿——两处都是客户端可控，既可能
-- 前后不一致，也给了「展示一个价、下单另一个价」的空间。
-- 现在国家落在购物车上，合计一律读它，客户端不再参与金额计算（ADR-019）。

ALTER TABLE cart ADD COLUMN IF NOT EXISTS shipping_country char(2);
