-- links 关联表 0002：交易核心 6 张（架构 §4.3）。
-- 无 REFERENCES、无业务字段；唯一索引带 WHERE deleted_at IS NULL。删除语义在 definitions.ts 标注。

CREATE TABLE inventory_item_variant (
  id                text PRIMARY KEY,
  inventory_item_id text NOT NULL,
  variant_id        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_inventory_item_variant_item ON inventory_item_variant (inventory_item_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_inventory_item_variant_variant ON inventory_item_variant (variant_id) WHERE deleted_at IS NULL;

CREATE TABLE stock_location_channel (
  id                text PRIMARY KEY,
  stock_location_id text NOT NULL,
  channel_id        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_stock_location_channel ON stock_location_channel (stock_location_id, channel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_stock_location_channel_channel ON stock_location_channel (channel_id);

CREATE TABLE cart_customer (
  id          text PRIMARY KEY,
  cart_id     text NOT NULL,
  customer_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_cart_customer ON cart_customer (cart_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cart_customer_customer ON cart_customer (customer_id);

CREATE TABLE order_customer (
  id          text PRIMARY KEY,
  order_id    text NOT NULL,
  customer_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_order_customer ON order_customer (order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_order_customer_customer ON order_customer (customer_id);

CREATE TABLE order_payment_collection (
  id                    text PRIMARY KEY,
  order_id              text NOT NULL,
  payment_collection_id text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX uq_order_payment_collection ON order_payment_collection (order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_order_payment_collection_pc ON order_payment_collection (payment_collection_id);

CREATE TABLE order_fulfillment (
  id             text PRIMARY KEY,
  order_id       text NOT NULL,
  fulfillment_id text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX uq_order_fulfillment ON order_fulfillment (fulfillment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_order_fulfillment_order ON order_fulfillment (order_id);
