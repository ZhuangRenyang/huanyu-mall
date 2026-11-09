-- M06 Payment 0001_init（7 表）。验签失败不落库；webhook 唯一去重；幂等键唯一。

CREATE TABLE payment_collection (
  id            text PRIMARY KEY,
  cart_id       text,
  order_id      text,
  currency_code char(3) NOT NULL,
  amount_minor  bigint NOT NULL,
  status        text NOT NULL DEFAULT 'not_paid',
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE payment_session (
  id                    text PRIMARY KEY,
  payment_collection_id text NOT NULL REFERENCES payment_collection(id),
  provider_id           text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  amount_minor          bigint NOT NULL,
  currency_code         char(3) NOT NULL,
  provider_reference    text,
  provider_raw          jsonb,
  context               jsonb,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX idx_paysess_collection ON payment_session (payment_collection_id);

CREATE TABLE payment (
  id                    text PRIMARY KEY,
  payment_collection_id text NOT NULL REFERENCES payment_collection(id),
  session_id            text,
  amount_minor          bigint NOT NULL,
  currency_code         char(3) NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  provider_id           text NOT NULL,
  provider_reference    text,
  captured_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX idx_pay_collection ON payment (payment_collection_id);

CREATE TABLE payment_transaction (
  id                 text PRIMARY KEY,
  payment_id         text NOT NULL REFERENCES payment(id),
  type               text NOT NULL,
  amount_minor       bigint NOT NULL,
  currency_code      char(3) NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  provider_reference text,
  provider_raw       jsonb,
  idempotency_key    text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX idx_paytxn_payment ON payment_transaction (payment_id);
CREATE UNIQUE INDEX uq_paytxn_idem ON payment_transaction (idempotency_key) WHERE deleted_at IS NULL;

CREATE TABLE refund (
  id                 text PRIMARY KEY,
  payment_id         text NOT NULL REFERENCES payment(id),
  order_id           text,
  amount_minor       bigint NOT NULL,
  currency_code      char(3) NOT NULL,
  reason             text,
  status             text NOT NULL DEFAULT 'pending',
  provider_reference text,
  idempotency_key    text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX idx_rfd_payment ON refund (payment_id);
CREATE UNIQUE INDEX uq_refund_idem ON refund (idempotency_key) WHERE deleted_at IS NULL;

CREATE TABLE payment_provider_config (
  id                text PRIMARY KEY,
  identifier        text NOT NULL,
  label             text NOT NULL,
  capabilities      jsonb,
  options_encrypted text,
  is_enabled        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_ppc_identifier ON payment_provider_config (identifier) WHERE deleted_at IS NULL;

CREATE TABLE provider_webhook_event (
  id           text PRIMARY KEY,
  provider_id  text NOT NULL,
  event_id     text NOT NULL,
  payload      jsonb NOT NULL,
  raw          jsonb,
  processed    boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_pwebhook_event ON provider_webhook_event (provider_id, event_id);
