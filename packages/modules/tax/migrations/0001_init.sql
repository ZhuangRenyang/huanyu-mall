-- M09 Tax 0001_init（2 表）。一期：Channel 级单一扁平税率 + 含税价，不做税区/多税率。

CREATE TABLE tax_rate (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  rate_bps     integer NOT NULL,
  is_inclusive boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE tax_rate_rule (
  id           text PRIMARY KEY,
  tax_rate_id  text NOT NULL REFERENCES tax_rate(id),
  rule_type    text NOT NULL,
  rule_value   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX idx_taxr_rate ON tax_rate_rule (tax_rate_id);
