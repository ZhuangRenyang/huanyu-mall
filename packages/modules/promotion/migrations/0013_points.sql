-- M06 0013：积分账本（ADR-093）。
--
-- 积分是顾客资产，但不是钱：订单完成发放、结账抵扣、不可提现。
-- 点数用 bigint 整数；抵扣换算（100 点 = 1 元）在服务层用常量，见 types.POINT_*。
--
-- balance 单行存当前余额，ledger 存流水（含 balance_after 快照，对账可回溯）。
-- 同一订单只发一次积分：unique partial index 兜底幂等。

CREATE TABLE IF NOT EXISTS point_balance (
  customer_id text PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_point_balance_nonneg CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  kind text NOT NULL,  -- 'earn' | 'spend' | 'refund' | 'adjust'
  delta bigint NOT NULL,  -- 正=增加，负=减少
  balance_after bigint NOT NULL,
  order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_customer ON point_ledger (customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ledger_earn_order ON point_ledger (order_id)
  WHERE kind = 'earn' AND order_id IS NOT NULL;

COMMENT ON TABLE point_balance IS '顾客积分余额（ADR-093）';
COMMENT ON TABLE point_ledger IS '积分流水（ADR-093）：earn/spend/refund/adjust，balance_after 可回溯对账';
