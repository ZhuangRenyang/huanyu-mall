-- M05 0011：订单发票（ADR-098）。
--
-- 不接税务服务商，做「手工登记」版：顾客提交抬头 → 商家线下开票 → 后台登记发票号。
-- 一张订单只能申请一次（淘宝同此：已开票要红冲/换开属另一套流程），unique(order_id) 兜底。

CREATE TABLE IF NOT EXISTS order_invoice (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  customer_id text,
  -- personal = 个人（只填抬头）；company = 企业（抬头 + 税号）
  type text NOT NULL DEFAULT 'personal',
  title text NOT NULL,
  tax_id text,
  email text NOT NULL,
  amount_minor bigint NOT NULL,
  currency_code char(3) NOT NULL,
  remark text,
  -- pending = 待开票；issued = 已开票；rejected = 已拒绝
  status text NOT NULL DEFAULT 'pending',
  invoice_no text,
  issued_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_invoice_type CHECK (type IN ('personal', 'company')),
  CONSTRAINT chk_order_invoice_status CHECK (status IN ('pending', 'issued', 'rejected'))
);

-- 一张订单只能有一张发票单：重复申请会开出两张，账对不上
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_invoice_order ON order_invoice (order_id);
CREATE INDEX IF NOT EXISTS idx_order_invoice_status ON order_invoice (status, created_at DESC);

COMMENT ON TABLE order_invoice IS '订单发票申请单（ADR-098）：手工登记版，一张订单一张';
COMMENT ON COLUMN order_invoice.status IS 'pending = 待开票；issued = 已开票；rejected = 已拒绝';
COMMENT ON COLUMN order_invoice.invoice_no IS '商家线下开出的发票号码，开票后登记';
