-- M04 Cart 0002：目录促销行级折扣字段（阶段 2，ADR-012 §3）。
-- 只增不删（ALTER ADD COLUMN），不改动既有列。

ALTER TABLE cart_line_item_adjustment ADD COLUMN promotion_id text;
ALTER TABLE cart_line_item_adjustment ADD COLUMN code text;
ALTER TABLE cart_line_item_adjustment ADD COLUMN is_tax_inclusive boolean NOT NULL DEFAULT false;
