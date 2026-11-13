-- M09 0003：退款进度通知开关（ADR-072）。
--
-- 顾客申请退款后，商家同意或拒绝，此前没有任何回音 —— 他只能自己回店铺看。
-- 与其它交易类邮件同一组开关：商家可以只发其中几类，默认开。

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS refund_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN notification_settings.refund_enabled IS '退款进度邮件开关（ADR-072）';
