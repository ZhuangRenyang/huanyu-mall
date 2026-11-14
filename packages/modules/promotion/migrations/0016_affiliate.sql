-- M06 0016：分销（ADR-101）。
--
-- 推广员是**顾客**（不是后台员工）：商家在后台把某个客户设为推广员，给他一个推广码。
-- 顾客带码下单 → 订单记 affiliate_id → 订单完成后生成一笔佣金流水。
--
-- 佣金只是**账本**：pending（待结算）→ settled（商家线下打款后标记）/ canceled（退款作废）。
-- 系统不发一分钱：提现走人工，与 ADR-023（不做自动退款/自动打款）一致。
--
-- 佣金比例上限 30%：超过这个数不是分销，是清仓。

CREATE TABLE IF NOT EXISTS affiliate (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  -- 推广码：大写字母数字，顾客手输也不易错
  code text NOT NULL,
  -- 佣金比例（万分比）：500 = 5%
  commission_bps integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_affiliate_bps CHECK (commission_bps > 0 AND commission_bps <= 3000),
  CONSTRAINT chk_affiliate_status CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_customer ON affiliate (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_code ON affiliate (code);

CREATE TABLE IF NOT EXISTS affiliate_commission (
  id text PRIMARY KEY,
  affiliate_id text NOT NULL,
  order_id text NOT NULL,
  -- 基数快照：下单时的实付金额，订单后来改了也不影响历史佣金
  order_total_minor bigint NOT NULL,
  commission_minor bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  settled_at timestamptz,
  canceled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_commission_status CHECK (status IN ('pending', 'settled', 'canceled')),
  CONSTRAINT chk_commission_amount CHECK (commission_minor > 0)
);

-- 一张订单最多一笔佣金：重复确认收货不会重复计提
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_order ON affiliate_commission (order_id);
CREATE INDEX IF NOT EXISTS idx_commission_affiliate ON affiliate_commission (affiliate_id, status);

COMMENT ON TABLE affiliate IS '推广员（ADR-101）：推广码 + 佣金比例，不产生任何自动打款';
COMMENT ON TABLE affiliate_commission IS '佣金流水（ADR-101）：pending → settled / canceled，由商家人工结算';
