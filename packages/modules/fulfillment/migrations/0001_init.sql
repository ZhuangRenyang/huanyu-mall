-- M08 Fulfillment 0001_init（6 表）。承运商 API 不接，发货手填承运商 + 单号。

CREATE TABLE shipping_zone (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  country_codes jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE shipping_option (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  zone_id       text NOT NULL REFERENCES shipping_zone(id),
  carrier       text,
  type          text NOT NULL DEFAULT 'flat',
  amount_minor  bigint NOT NULL,
  currency_code char(3) NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX idx_shipopt_zone ON shipping_option (zone_id);

CREATE TABLE shipping_option_price_rule (
  id                 text PRIMARY KEY,
  shipping_option_id text NOT NULL REFERENCES shipping_option(id),
  rule_type          text NOT NULL,
  weight_min_g       integer,
  weight_max_g       integer,
  order_over_minor   bigint,
  amount_minor       bigint NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX idx_shiprule_option ON shipping_option_price_rule (shipping_option_id);

CREATE TABLE fulfillment (
  id             text PRIMARY KEY,
  order_id       text NOT NULL,
  status         text NOT NULL DEFAULT 'not_fulfilled',
  tracking_links jsonb,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX idx_fulf_order ON fulfillment (order_id);

CREATE TABLE fulfillment_item (
  id                 text PRIMARY KEY,
  fulfillment_id     text NOT NULL REFERENCES fulfillment(id),
  order_line_item_id text NOT NULL,
  quantity           integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fulfitem_fulfillment ON fulfillment_item (fulfillment_id);

CREATE TABLE shipment (
  id              text PRIMARY KEY,
  fulfillment_id  text NOT NULL REFERENCES fulfillment(id),
  carrier_name    text NOT NULL,
  tracking_number text NOT NULL,
  shipped_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ship_fulfillment ON shipment (fulfillment_id);
