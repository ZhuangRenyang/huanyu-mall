-- links 关联表 0003：tax_rate_channel（N:1，一期一渠道一税率）。
-- 无 REFERENCES、无业务字段；唯一索引带 WHERE deleted_at IS NULL。

CREATE TABLE tax_rate_channel (
  id          text PRIMARY KEY,
  tax_rate_id text NOT NULL,
  channel_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_tax_rate_channel ON tax_rate_channel (channel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tax_rate_channel_rate ON tax_rate_channel (tax_rate_id);
