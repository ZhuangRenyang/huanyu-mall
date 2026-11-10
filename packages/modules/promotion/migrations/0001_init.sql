-- M-promotion 0001_init（6 表）：目录/订单促销 + 规则、优惠券 + 券码、礼品卡 + 流水（对齐 ADR-012）。
-- 金额一律 bigint minor unit；软删除统一 deleted_at（gift_card_event 为只追加流水，无 updated_at/deleted_at）。
-- promotion.code 用 partial unique index 允许多个 NULL；gift_card.current_balance 用 CHECK 兜底非负。

CREATE TABLE promotion (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  code         text,
  type         text NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  is_automatic boolean NOT NULL DEFAULT false,
  starts_at    timestamptz,
  ends_at      timestamptz,
  usage_limit  integer,
  used         integer NOT NULL DEFAULT 0,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX uq_promotion_code ON promotion (code) WHERE code IS NOT NULL;

CREATE TABLE promotion_rule (
  id           text PRIMARY KEY,
  promotion_id text NOT NULL REFERENCES promotion(id),
  predicate    jsonb NOT NULL DEFAULT '{}',
  reward_type  text NOT NULL,
  reward_value bigint NOT NULL,
  allocation   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX idx_promo_rule_promotion ON promotion_rule (promotion_id);

CREATE TABLE voucher (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  type           text NOT NULL DEFAULT 'entire_order',
  usage_limit    integer,
  starts_at      timestamptz,
  ends_at        timestamptz,
  discount_type  text NOT NULL,
  discount_value bigint NOT NULL,
  min_spent      bigint,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE voucher_code (
  id         text PRIMARY KEY,
  voucher_id text NOT NULL REFERENCES voucher(id),
  code       text NOT NULL,
  used       integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_voucher_code_code ON voucher_code (code);
CREATE INDEX idx_voucher_code_voucher ON voucher_code (voucher_id);

CREATE TABLE gift_card (
  id              text PRIMARY KEY,
  code            text NOT NULL,
  currency        char(3) NOT NULL,
  initial_balance bigint NOT NULL,
  current_balance bigint NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  expires_at      timestamptz,
  assigned_to     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT chk_gift_card_balance_nonneg CHECK (current_balance >= 0)
);
CREATE UNIQUE INDEX uq_gift_card_code ON gift_card (code);

CREATE TABLE gift_card_event (
  id           text PRIMARY KEY,
  gift_card_id text NOT NULL REFERENCES gift_card(id),
  type         text NOT NULL,
  amount       bigint NOT NULL,
  order_id     text,
  parameters   jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gift_card_event_card ON gift_card_event (gift_card_id);
