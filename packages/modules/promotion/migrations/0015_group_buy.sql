-- M06 0015：拼团（ADR-100）。
--
-- 与「先付款再等人凑齐」的模式不同，本项目的拼团是**参团免费、成团领券**：
--   - 参团不收款、不建订单、不占库存；
--   - 成团后每个成员领一张「拼团专享券」，拿券正常下单；
--   - 未成团什么都不发生（没收过钱，也就没有退款）。
--
-- 这样拼团不会新增任何无人值守的资金动作，与 ADR-023（退款只走人工审核）不冲突。
--
-- member_count 存在团上，用条件 UPDATE（member_count + 1 <= team_size）加减，
-- 并发参团不会超员。

CREATE TABLE IF NOT EXISTS group_buy (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- 活动只针对一个规格：一个活动一个价，规则才解释得清
  variant_id text NOT NULL,
  product_id text NOT NULL,
  -- 商品/规格快照：商品改名或下架后，活动页与券记录仍可读
  title text NOT NULL,
  original_price_minor bigint NOT NULL,
  group_price_minor bigint NOT NULL,
  -- 成团人数（含团长），2–10
  team_size integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- 成团后发放的专享券（由本模块自动创建，is_public = false）
  voucher_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_group_buy_status CHECK (status IN ('draft', 'active', 'ended')),
  CONSTRAINT chk_group_buy_window CHECK (ends_at > starts_at),
  CONSTRAINT chk_group_buy_size CHECK (team_size >= 2 AND team_size <= 10),
  CONSTRAINT chk_group_buy_price CHECK (group_price_minor > 0 AND group_price_minor < original_price_minor)
);

CREATE TABLE IF NOT EXISTS group_buy_team (
  id text PRIMARY KEY,
  group_buy_id text NOT NULL,
  leader_customer_id text NOT NULL,
  status text NOT NULL DEFAULT 'forming',
  member_count integer NOT NULL DEFAULT 0,
  -- 成团人数快照：活动后来改人数，已开的团仍按当时规则走
  team_size integer NOT NULL,
  -- 团跟活动同期结束：到点未满即失效
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_group_team_status CHECK (status IN ('forming', 'success', 'expired')),
  CONSTRAINT chk_group_team_members CHECK (member_count >= 0 AND member_count <= team_size)
);

CREATE TABLE IF NOT EXISTS group_buy_member (
  id text PRIMARY KEY,
  team_id text NOT NULL,
  customer_id text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);

-- 一个人在同一个团里只能出现一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_member_team_customer ON group_buy_member (team_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_group_team_activity ON group_buy_team (group_buy_id, status);
CREATE INDEX IF NOT EXISTS idx_group_member_customer ON group_buy_member (customer_id);
CREATE INDEX IF NOT EXISTS idx_group_buy_window ON group_buy (status, starts_at, ends_at);

COMMENT ON TABLE group_buy IS '拼团活动（ADR-100）：参团免费、成团领券，不产生资金动作';
COMMENT ON TABLE group_buy_team IS '拼团团（ADR-100）：member_count 条件更新防超员，过期惰性判定';
COMMENT ON TABLE group_buy_member IS '拼团成员（ADR-100）：用于「我的拼团」与成团后领券资格';
