-- M05 Order 0001_init（5 表）。行快照冻结（order_line_item + order_item_snapshot）；无软删（取消用 status=canceled）。

CREATE TABLE "order" (
  id                    text PRIMARY KEY,
  status                text NOT NULL DEFAULT 'pending',
  cart_id               text,
  customer_id           text,
  email                 text NOT NULL,
  currency_code         char(3) NOT NULL,
  channel_id            text NOT NULL,
  region_id             text NOT NULL,
  subtotal_minor        bigint NOT NULL,
  shipping_minor        bigint NOT NULL DEFAULT 0,
  tax_minor             bigint NOT NULL DEFAULT 0,
  discount_minor        bigint NOT NULL DEFAULT 0,
  total_minor           bigint NOT NULL,
  payment_status        text NOT NULL DEFAULT 'unpaid',
  shipping_address      jsonb NOT NULL,
  billing_address       jsonb,
  payment_collection_id text,
  metadata              jsonb,
  placed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_status ON "order" (status);
CREATE INDEX idx_order_channel ON "order" (channel_id);
CREATE INDEX idx_order_customer ON "order" (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE order_line_item (
  id               text PRIMARY KEY,
  order_id         text NOT NULL REFERENCES "order"(id),
  variant_id       text NOT NULL,
  product_id       text NOT NULL,
  title            text NOT NULL,
  sku              text NOT NULL,
  quantity         integer NOT NULL,
  unit_price_minor bigint NOT NULL,
  tax_rate_bps     integer NOT NULL DEFAULT 0,
  tax_amount_minor bigint NOT NULL DEFAULT 0,
  total_minor      bigint NOT NULL,
  currency_code    char(3) NOT NULL,
  options          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_oli_order ON order_line_item (order_id);

CREATE TABLE order_item_snapshot (
  id                 text PRIMARY KEY,
  order_line_item_id text NOT NULL REFERENCES order_line_item(id),
  snapshot           jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ois_line ON order_item_snapshot (order_line_item_id);

CREATE TABLE order_shipping_method (
  id           text PRIMARY KEY,
  order_id     text NOT NULL REFERENCES "order"(id),
  name         text NOT NULL,
  carrier_name text,
  amount_minor bigint NOT NULL,
  currency_code char(3) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_osm_order ON order_shipping_method (order_id);

CREATE TABLE order_status_history (
  id          text PRIMARY KEY,
  order_id    text NOT NULL REFERENCES "order"(id),
  from_status text,
  to_status   text NOT NULL,
  actor       text NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_osh_order ON order_status_history (order_id, created_at);
