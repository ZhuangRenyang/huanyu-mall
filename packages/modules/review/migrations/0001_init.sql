-- M-review 0001_init（1 表）：商品评价（ADR-042）。
--
-- 说明：
-- - 不建跨模块外键（product / order 属其它模块的表），与 promotion.voucher_collection 同口径；
--   product_title / customer_name 建单时做快照，商品改名或顾客注销后评价仍可读。
-- - rating 用 CHECK 限制 1..5：评分是聚合项，脏数据会让平均分永久失真。
-- - 一条订单里同一商品只能评一次：部分唯一索引（软删后可重评）。

CREATE TABLE product_review (
  id            text PRIMARY KEY,
  product_id    text NOT NULL,
  product_title text NOT NULL,
  order_id      text NOT NULL,
  customer_id   text NOT NULL,
  customer_name text NOT NULL,
  rating        integer NOT NULL,
  content       text NOT NULL DEFAULT '',
  is_visible    boolean NOT NULL DEFAULT true,
  reply         text,
  replied_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT ck_product_review_rating CHECK (rating BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX uq_product_review_order_product
  ON product_review (order_id, product_id, customer_id)
  WHERE deleted_at IS NULL;

-- 店面详情页：取某商品「可见」评价，按时间倒序
CREATE INDEX idx_product_review_product
  ON product_review (product_id, created_at DESC)
  WHERE deleted_at IS NULL AND is_visible;

-- 后台列表：全部评价按时间倒序（含隐藏）
CREATE INDEX idx_product_review_admin ON product_review (created_at DESC);
