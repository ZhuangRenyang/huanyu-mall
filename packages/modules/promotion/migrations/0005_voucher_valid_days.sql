-- M06 0005：券的「领取后 N 天有效」（ADR-085）。
ALTER TABLE voucher ADD COLUMN IF NOT EXISTS valid_days integer;
ALTER TABLE voucher_code ADD COLUMN IF NOT EXISTS expires_at timestamptz;
COMMENT ON COLUMN voucher.valid_days IS '非空时：领取那一刻起 N 天内有效，与固定区间取交集（ADR-085）';
COMMENT ON COLUMN voucher_code.expires_at IS '领取时按 valid_days 算出的到期时间；空 = 跟随券的 ends_at';
