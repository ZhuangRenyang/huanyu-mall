-- M10 0006：会员标签（ADR-103）。
--
-- 标签是**多对多**：一个客户可以有多个标签，一个标签下有多个客户。
-- 与「分组」的区别：分组是互斥的一档，标签可以并存。
--
-- 为什么不做「分组折扣」：分组折扣与会员等级折扣（ADR-102）语义重叠，
-- 两个都做会出现「同一件商品按哪个折扣」，客服解释不清。分组统一由等级承载。

CREATE TABLE IF NOT EXISTS customer_tag (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_tag_name ON customer_tag (name);

CREATE TABLE IF NOT EXISTS customer_tag_link (
  customer_id text NOT NULL,
  tag_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_tag_link_tag ON customer_tag_link (tag_id);

COMMENT ON TABLE customer_tag IS '会员标签（ADR-103）：多对多，用于筛选与画像';
COMMENT ON TABLE customer_tag_link IS '客户-标签关联（ADR-103）：主键即去重，重复打标幂等';
