-- M-promotion 0002_features：营销功能级开关（ADR-014 简单优先 + 用户要求默认关闭）。
-- 三个功能默认全部关闭；后台在各自菜单页打开后才参与 computeDiscounts。
-- 关闭只影响后续计算，不删除任何活动，也不改历史订单。

CREATE TABLE promotion_feature (
  feature    text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO promotion_feature (feature, enabled) VALUES
  ('promotion', false),
  ('voucher', false),
  ('gift_card', false)
ON CONFLICT (feature) DO NOTHING;
