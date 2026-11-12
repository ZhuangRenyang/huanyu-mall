-- M-promotion 0003：可领取的店铺券（ADR-029）。
--
-- 改造前只有「券模板 + 券码」：商家生成一批码，顾客必须拿到码再输入。
-- 淘宝/京东的店铺券是另一条路：商品页上写着「满 199 减 20 · 领取」，
-- 顾客点一下就进自己的卡券包，下单时直接选 —— 不需要记住一串码。
--
-- 所以补两样东西：
--   1. voucher 上加「是否公开领取」「每人限领」；
--   2. 领取记录表，保存「谁在什么时候领了哪张券、换到的是哪条券码」。
--
-- 领取时仍然生成一条 voucher_code：这样核销链路（consumeVoucherCodes /
-- releaseVoucherCodes / 溢出保护）一行都不用改，领券只是「自动发码」。

ALTER TABLE voucher ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE voucher ADD COLUMN IF NOT EXISTS collect_limit integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS voucher_collection (
  id           text PRIMARY KEY,
  voucher_id   text NOT NULL REFERENCES voucher(id),
  customer_id  text NOT NULL,
  -- 领取时发出的券码；核销仍走 voucher_code，这条只是把「谁的券」绑起来
  code_id      text NOT NULL REFERENCES voucher_code(id),
  -- unused | used（过期不落库：状态由 voucher.ends_at 现算）
  status       text NOT NULL DEFAULT 'unused',
  collected_at timestamptz NOT NULL DEFAULT now(),
  used_at      timestamptz,
  order_id     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 「我的卡券」按顾客查；「这张券领了几张」按券 + 顾客查
CREATE INDEX IF NOT EXISTS idx_voucher_collection_customer
  ON voucher_collection (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_collection_voucher
  ON voucher_collection (voucher_id, customer_id);
