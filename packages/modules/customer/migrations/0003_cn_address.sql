-- M10 Customer 0003：地址字段对齐中国习惯（ADR-026）。
--
-- 原表按 Shopify 的西方地址习惯建：姓名拆 first/last、城市与邮编分开必填。
-- 淘宝的收货地址是四个字段：收件人（一个）、所在地区（省市区一整串）、详细地址、手机号，
-- 邮编选填、很多人根本不知道。
--
-- 与其逼顾客在「姓」「名」「城市」「邮编」里瞎填，不如放宽约束：
-- 数据可以少，但不能假 —— 假的城市名会让后台客户详情和发货单都没法用。
-- 「省市区」整串落在 province（与结账页 region → province 的口径一致），city 留空。
--
-- 只放宽约束，不删列不改类型：后台手工建的地址数据不受影响。

ALTER TABLE customer_address ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE customer_address ALTER COLUMN city DROP NOT NULL;
ALTER TABLE customer_address ALTER COLUMN postal_code DROP NOT NULL;

-- 默认地址唯一性靠服务层保证（先清后设），这里只补一个「按客户找默认地址」的索引。
CREATE INDEX IF NOT EXISTS idx_addr_customer_default
  ON customer_address (customer_id)
  WHERE is_default_shipping = true AND deleted_at IS NULL;
