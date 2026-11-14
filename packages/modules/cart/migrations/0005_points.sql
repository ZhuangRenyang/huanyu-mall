-- M-cart 0005：购物车积分抵扣意愿（ADR-094）。
--
-- 顾客在结账时选择「用多少积分」，意愿持久化到购物车（刷新不丢），
-- 抵扣金额由 promotion 侧读时折算并封顶 —— 购物车只存「想用多少点」，不存金额。

ALTER TABLE cart ADD COLUMN IF NOT EXISTS points_to_use bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN cart.points_to_use IS '顾客想用的积分数（ADR-094）；抵扣额由 promotion 折算封顶';
