-- M17 0005：首页轮播图（ADR-080）。
--
-- 装修的第二块能力：商家自己换首页大图与跳转，不用改代码。
-- 图片存 file_id（与商品图同一套上传与 URL 解析），链接只存站内路径或 https 外链。

CREATE TABLE IF NOT EXISTS theme_banner (
  id text PRIMARY KEY,
  image_file_id text NOT NULL,
  link text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS theme_banner_active_idx ON theme_banner (is_active, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE theme_banner IS '首页轮播图（ADR-080）';
COMMENT ON COLUMN theme_banner.link IS '站内路径（/zh-CN/cn/products）或 https 外链；空=不可点';
