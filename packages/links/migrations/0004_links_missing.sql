-- links 关联表 0004：补齐架构 §4.3 定义但此前遗漏的 3 张。
-- shipping_option_channel / payment_provider_channel / product_image_file。
-- 无 REFERENCES、无业务字段；唯一索引带 WHERE deleted_at IS NULL。

CREATE TABLE shipping_option_channel (
  id                 text PRIMARY KEY,
  shipping_option_id text NOT NULL,
  channel_id         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX uq_shipping_option_channel ON shipping_option_channel (shipping_option_id, channel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_shipping_option_channel_channel ON shipping_option_channel (channel_id);

CREATE TABLE payment_provider_channel (
  id                 text PRIMARY KEY,
  provider_config_id text NOT NULL,
  channel_id         text NOT NULL,
  is_enabled         boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX uq_payment_provider_channel ON payment_provider_channel (provider_config_id, channel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payment_provider_channel_channel ON payment_provider_channel (channel_id);

CREATE TABLE product_image_file (
  id               text PRIMARY KEY,
  product_image_id text NOT NULL,
  file_id          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX uq_product_image_file ON product_image_file (product_image_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_image_file_file ON product_image_file (file_id);
