-- M-notification 0001_init：订单邮件通知（ADR-016）。
-- 两张表：
--   notification_settings  单例行，SMTP 配置与功能开关（默认全关，没配 SMTP 就发不出去）
--   notification           发信 outbox：pending/sending/sent/failed，dedupe_key 防重复发
-- SMTP 密码用 AES-256-GCM 加密后存 smtp_password_enc，明文永不落库。

CREATE TABLE notification_settings (
  id                        text PRIMARY KEY,
  enabled                   boolean NOT NULL DEFAULT false,
  from_name                 text NOT NULL DEFAULT '',
  from_email                text NOT NULL DEFAULT '',
  smtp_host                 text NOT NULL DEFAULT '',
  smtp_port                 integer NOT NULL DEFAULT 587,
  smtp_secure               boolean NOT NULL DEFAULT false,
  smtp_user                 text NOT NULL DEFAULT '',
  smtp_password_enc         text,
  order_confirmation_enabled boolean NOT NULL DEFAULT true,
  shipment_enabled          boolean NOT NULL DEFAULT true,
  storefront_url            text NOT NULL DEFAULT '',
  updated_at                timestamptz NOT NULL DEFAULT now()
);

INSERT INTO notification_settings (id) VALUES ('notification_default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE notification (
  id              text PRIMARY KEY,
  template        text NOT NULL,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  body_html       text NOT NULL,
  body_text       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  error           text,
  order_id        text,
  dedupe_key      text NOT NULL,
  next_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

-- 事件是 at-least-once：靠唯一索引挡住重投造成的重复发信
CREATE UNIQUE INDEX notification_dedupe_key_uq ON notification (dedupe_key);
CREATE INDEX notification_status_created_idx ON notification (status, created_at);
CREATE INDEX notification_order_idx ON notification (order_id);
