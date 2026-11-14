-- M10 0005：会员等级（ADR-102）。
--
-- 等级只做两件事：给一个名字、给一个折扣。归属由「累计消费」自动匹配
-- （读的时候算，不落库、不跑定时任务）：等级规则改了，顾客立刻按新规则走。
--
-- discount_bps 是**折扣力度**（万分比）：500 = 便宜 5%，950 → 9.5 折。
-- 上限 30%：再高就不是会员权益，是清仓。

CREATE TABLE IF NOT EXISTS member_level (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- 达到该累计消费（minor unit）即为这一档
  threshold_minor bigint NOT NULL DEFAULT 0,
  discount_bps integer NOT NULL,
  -- 仅用于展示排序（等级从低到高）
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_member_level_threshold CHECK (threshold_minor >= 0),
  CONSTRAINT chk_member_level_bps CHECK (discount_bps > 0 AND discount_bps <= 3000)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_member_level_threshold ON member_level (threshold_minor);

COMMENT ON TABLE member_level IS '会员等级（ADR-102）：按累计消费自动匹配，等级折扣在结账时按行计算';
