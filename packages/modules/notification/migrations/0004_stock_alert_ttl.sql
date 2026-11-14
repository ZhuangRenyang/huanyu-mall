-- M09 0004：到货提醒有效期（天数）可配（ADR-089）。
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS stock_alert_ttl_days integer NOT NULL DEFAULT 30;
COMMENT ON COLUMN notification_settings.stock_alert_ttl_days IS '到货提醒有效期天数：补货时只通知 N 天内登记过的顾客（ADR-089）';
