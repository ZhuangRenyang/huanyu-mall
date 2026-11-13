-- M-promotion 0004：优惠券适用范围（ADR-064）。
--
-- 之前 voucher.type 里就有 'specific_product'，但 computeDiscounts 压根不读它：
-- 后台让商家选「指定商品」，券却按整单减 —— 商家每核销一张就多亏一单。
-- 这里补上真正的适用范围：一张券可以限定「某些商品 / 某些分类」，只有命中的行才参与
-- 满减门槛与折扣计算。
--
-- 为什么拆成独立表而不是在 voucher 上加数组列：
--   scope 是「券 × 商品/分类」的多对多关系，独立表才能加唯一索引、按 voucher 批量查、
--   编辑时整表替换（先删后插）而不污染主表。
-- scope_id 不建外键：商品/分类分属别的模块，外键会把促销模块钉死在它们的表结构上。

CREATE TABLE IF NOT EXISTS voucher_scope (
  id          text PRIMARY KEY,
  voucher_id  text NOT NULL,
  scope_type  text NOT NULL CHECK (scope_type IN ('product', 'category')),
  scope_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 同一张券里同一条范围只存一次（重复勾选是常态，不是错误）
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_scope_voucher_type_id
  ON voucher_scope (voucher_id, scope_type, scope_id);

-- 结账算折扣按券批量取范围
CREATE INDEX IF NOT EXISTS idx_voucher_scope_voucher
  ON voucher_scope (voucher_id);

COMMENT ON COLUMN voucher_scope.scope_type IS 'product=指定商品；category=指定分类';
