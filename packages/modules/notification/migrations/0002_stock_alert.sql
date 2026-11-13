-- M09 0002：到货通知开关（ADR-059）。
--
-- 与「下单确认」「发货通知」同一组开关：商家可能只想发其中几类。
-- 默认 true —— 顾客主动登记了提醒，不发等于失信；要关自己去后台关。

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS stock_alert_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN notification_settings.stock_alert_enabled IS '到货提醒邮件开关（ADR-059）';
