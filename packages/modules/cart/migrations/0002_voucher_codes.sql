-- M04 Cart 0002_voucher_codes（阶段 4 Voucher）：cart 表加 voucher_codes jsonb，
-- 持久化顾客输入的优惠券码（string[]），刷新不丢；金额由 promotion 侧读时算，禁客户端传价。

ALTER TABLE cart ADD COLUMN voucher_codes jsonb;
