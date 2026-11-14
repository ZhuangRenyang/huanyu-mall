-- M06 0006：阶梯满减（ADR-086）。
ALTER TABLE voucher ADD COLUMN IF NOT EXISTS tiers jsonb;
COMMENT ON COLUMN voucher.tiers IS '阶梯满减：[{"min_spent_minor":19900,"discount_minor":2000}]；空 = 用单档 min_spent + discount_value';
