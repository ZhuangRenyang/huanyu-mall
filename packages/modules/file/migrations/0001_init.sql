-- M13 File 0001_init（2 表）
-- 文件名落库用随机 key（防路径穿越），content_type 由魔数判定（坑 10）。

CREATE TABLE file (
  id               text PRIMARY KEY,
  key              text NOT NULL,
  filename         text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       bigint NOT NULL,
  width_px         integer,
  height_px        integer,
  storage_provider text NOT NULL DEFAULT 'local',
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX uq_file_key ON file (key) WHERE deleted_at IS NULL;

CREATE TABLE file_variant (
  id         text PRIMARY KEY,
  file_id    text NOT NULL REFERENCES file(id),
  variant    text NOT NULL,
  key        text NOT NULL,
  width_px   integer,
  height_px  integer,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_file_variant ON file_variant (file_id, variant);
CREATE UNIQUE INDEX uq_file_variant_key ON file_variant (key) WHERE deleted_at IS NULL;
