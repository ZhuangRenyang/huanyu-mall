-- links 关联表（架构 §4.3）：无 REFERENCES、无业务字段；唯一索引带 WHERE deleted_at IS NULL。
-- 本文件只允许 CREATE（增量）。

CREATE TABLE product_channel (
  id         text PRIMARY KEY,
  product_id text NOT NULL,
  channel_id text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_product_channel ON product_channel (product_id, channel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_channel_channel ON product_channel (channel_id, product_id);

CREATE TABLE variant_price_set (
  id           text PRIMARY KEY,
  variant_id   text NOT NULL,
  price_set_id text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX uq_variant_price_set ON variant_price_set (variant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_variant_price_set_pset ON variant_price_set (price_set_id);

CREATE TABLE price_list_channel (
  id            text PRIMARY KEY,
  price_list_id text NOT NULL,
  channel_id    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX uq_price_list_channel ON price_list_channel (price_list_id, channel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_price_list_channel_channel ON price_list_channel (channel_id);
