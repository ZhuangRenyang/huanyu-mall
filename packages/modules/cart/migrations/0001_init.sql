-- M04 Cart 0001_init（4 表）。游客车 customer_id NULL（cart_customer 无行）。

CREATE TABLE cart (
  id            text PRIMARY KEY,
  channel_id    text NOT NULL,
  region_id     text NOT NULL,
  currency_code char(3) NOT NULL,
  customer_id   text,
  email         text,
  status        text NOT NULL DEFAULT 'open',
  totals        jsonb,
  metadata      jsonb,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX idx_cart_channel ON cart (channel_id);
CREATE INDEX idx_cart_customer ON cart (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE cart_line_item (
  id               text PRIMARY KEY,
  cart_id          text NOT NULL REFERENCES cart(id),
  variant_id       text NOT NULL,
  product_id       text NOT NULL,
  title            text NOT NULL,
  quantity         integer NOT NULL,
  unit_price_minor bigint NOT NULL,
  currency_code    char(3) NOT NULL,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX idx_cli_cart ON cart_line_item (cart_id);

CREATE TABLE cart_line_item_adjustment (
  id                text PRIMARY KEY,
  cart_line_item_id text NOT NULL REFERENCES cart_line_item(id),
  type              text NOT NULL,
  amount_minor      bigint NOT NULL,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX idx_clia_line ON cart_line_item_adjustment (cart_line_item_id);

CREATE TABLE cart_shipping_method (
  id                 text PRIMARY KEY,
  cart_id            text NOT NULL REFERENCES cart(id),
  shipping_option_id text NOT NULL,
  name               text NOT NULL,
  amount_minor       bigint NOT NULL,
  currency_code      char(3) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX idx_csm_cart ON cart_shipping_method (cart_id);
