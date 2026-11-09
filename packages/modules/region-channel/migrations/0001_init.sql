-- M03 Region + Channel 0001_init
-- 约定：id text ULID + 前缀；timestamptz UTC；软删 deleted_at + 部分唯一索引；模块内 FK 允许。
-- 本文件只允许 CREATE（增量），破坏性变更由 scripts/lint-migrations.ts 拦截。

CREATE TABLE region (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  currency_code char(3) NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE region_country (
  id           text PRIMARY KEY,
  region_id    text NOT NULL REFERENCES region(id),
  country_code char(2) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_region_country ON region_country (region_id, country_code);

CREATE TABLE channel (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  slug           text NOT NULL,
  currency_code  char(3) NOT NULL,
  region_id      text NOT NULL REFERENCES region(id),
  default_locale text NOT NULL DEFAULT 'zh-CN',
  market_scope   text NOT NULL DEFAULT 'cn',
  is_active      boolean NOT NULL DEFAULT true,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX uq_channel_slug ON channel (slug) WHERE deleted_at IS NULL;

CREATE TABLE channel_locale (
  id         text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channel(id),
  locale     text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_channel_locale ON channel_locale (channel_id, locale);
