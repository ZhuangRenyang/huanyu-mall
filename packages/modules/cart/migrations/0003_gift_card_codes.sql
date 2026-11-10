-- M04 Cart 0003_gift_card_codes（阶段 5 Gift Card）：cart 表加 gift_card_codes jsonb，
-- 持久化顾客输入的礼品卡码（string[]），刷新不丢；抵扣金额由 promotion 侧读时算，禁客户端传价。

ALTER TABLE cart ADD COLUMN gift_card_codes jsonb;
