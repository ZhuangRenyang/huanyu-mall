-- M-tax 0002_settings：税务开关与税名（ADR-018）。
-- 税率本身仍走 tax_rate + tax_rate_rule（ruleType=default / country），
-- 这里只放「收不收税、叫什么名、价格含不含税」这类店铺级策略。
-- enabled 默认 false：不配就不收税，和营销功能同一取向——不会因为装好就误收。

CREATE TABLE IF NOT EXISTS tax_settings (
  id                 text PRIMARY KEY,
  enabled            boolean NOT NULL DEFAULT false,
  tax_name           text NOT NULL DEFAULT '税',
  prices_include_tax boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tax_settings (id) VALUES ('tax_default')
ON CONFLICT (id) DO NOTHING;

-- 地区税率检索：按国家码取覆盖税率
CREATE INDEX IF NOT EXISTS idx_tax_rate_rule_value ON tax_rate_rule (rule_type, rule_value);
