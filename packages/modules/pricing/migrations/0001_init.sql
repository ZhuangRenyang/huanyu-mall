-- M02 Pricing 0001_init（4 表）
-- 金额 amount_minor bigint（禁 numeric/float），不做汇率换算。

CREATE TABLE price_set (
  id         text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE price_list (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'manual',
  starts_at  timestamptz,
  ends_at    timestamptz,
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE price (
  id                      text PRIMARY KEY,
  price_set_id            text NOT NULL REFERENCES price_set(id),
  currency_code           char(3) NOT NULL,
  amount_minor            bigint NOT NULL,
  compare_at_amount_minor bigint,
  price_list_id           text,
  min_quantity            integer NOT NULL DEFAULT 1,
  max_quantity            integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);
CREATE UNIQUE INDEX uq_price ON price (price_set_id, currency_code, price_list_id, min_quantity) WHERE deleted_at IS NULL;
CREATE INDEX idx_price_set ON price (price_set_id);

CREATE TABLE price_list_rule (
  id            text PRIMARY KEY,
  price_list_id text NOT NULL REFERENCES price_list(id),
  rule_type     text NOT NULL,
  rule_value    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX idx_plr_list ON price_list_rule (price_list_id);
