-- M10 0004：商品收藏（ADR-048）。
--
-- 收藏是「顾客对商品的关注」，不是订单的一部分：不建跨模块外键（商品属 product 模块），
-- 取消收藏直接删行 —— 收藏没有审计价值，软删只会让「同一商品反复收藏」堆积死行。

CREATE TABLE customer_favorite (
  id          text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id),
  product_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_customer_favorite ON customer_favorite (customer_id, product_id);
-- 列表：某顾客的收藏按时间倒序
CREATE INDEX idx_customer_favorite_customer ON customer_favorite (customer_id, created_at DESC);
