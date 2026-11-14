-- M17 0006：微页面（ADR-082）。
CREATE TABLE IF NOT EXISTS theme_micro_page (
  id text PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS theme_micro_page_slug_uq ON theme_micro_page (slug) WHERE deleted_at IS NULL;
COMMENT ON TABLE theme_micro_page IS '微页面（ADR-082）：标题 + 纯文本正文，按空行分段';
