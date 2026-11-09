-- M17 Theme 0001_init（2 表）。设计变量单一事实来源 + 版本留痕（换肤地基 / AC-13）。

CREATE TABLE theme_settings (
  id                  text PRIMARY KEY,
  primary_color       text NOT NULL,
  gradient_color      text NOT NULL,
  accent_color        text NOT NULL,
  font_family         text NOT NULL,
  border_radius       text NOT NULL,
  shadow              text NOT NULL,
  logo_file_id        text,
  product_image_ratio text NOT NULL,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE theme_revision (
  id           text PRIMARY KEY,
  version      integer NOT NULL,
  settings     jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_theme_revision_version ON theme_revision (version);
