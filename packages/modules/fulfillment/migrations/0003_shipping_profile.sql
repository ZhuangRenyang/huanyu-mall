-- M08 0003：运费模板（对齐淘宝「运费模板」/ Shopify「shipping profile」）。
--
-- 为什么要有这一层：运费不是全店一套，而是**随商品走**。
-- 淘宝上架商品必选运费模板，Shopify 每个商品属于一个 shipping profile。
-- 之前 zone/option 是全局的，商品侧无法差异化（重货、冷链、特殊类目做不到单独计费）。
--
-- 兼容：既有 zone 全部挂到默认模板，行为不变。

CREATE TABLE IF NOT EXISTS shipping_profile (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  /** 默认模板：商品未指定模板时用它；全店必须有一个且不可删。 */
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- 幂等播种：先建默认模板（已存在则跳过）
INSERT INTO shipping_profile (id, name, is_default)
VALUES ('shprof_default', '默认运费模板', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE shipping_zone ADD COLUMN IF NOT EXISTS profile_id text;

-- 既有发货区归到默认模板（只影响尚未归属的，可重复执行）
UPDATE shipping_zone SET profile_id = 'shprof_default' WHERE profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_zone_profile ON shipping_zone (profile_id);

COMMENT ON COLUMN shipping_zone.profile_id IS '所属运费模板；NULL 视同默认模板（历史数据兜底）';
