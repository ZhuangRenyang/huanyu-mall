-- M06 0004：退款申请单（售后单据）。
--
-- 为什么与 payment.refund 分开：
--   - `refund_request` 是**业务单据**：谁在什么时候因为什么申请退多少，商家怎么处理；
--   - `payment.refund` 是**资金流水**：真正打给支付通道的那一笔。
--   一张申请单可能因为没有支付单（未支付就取消）而永远不产生资金流水；
--   而资金流水也可能由商家主动发起（无申请单）。混成一张表会让两种语义互相污染。
--
-- 状态机（单向，不可回退）：
--   pending  ──同意──> approved   （退款已执行，refund_id 非空）
--      └────拒绝──> rejected     （review_note 必填）
--      └────买家撤销──> canceled

CREATE TABLE IF NOT EXISTS refund_request (
  id            text PRIMARY KEY,
  order_id      text NOT NULL,
  customer_id   text,
  amount_minor  bigint NOT NULL,
  currency_code char(3) NOT NULL,
  reason        text NOT NULL,
  /** 申请来源：customer = 买家申请；merchant = 商家主动退款。 */
  source        text NOT NULL DEFAULT 'customer',
  status        text NOT NULL DEFAULT 'pending',
  /** 商家处理说明（拒绝时必填，同意时可留空）。 */
  review_note   text,
  reviewed_at   timestamptz,
  /** 关联的资金流水 id（payment.refund.id），同意并执行成功后写入。 */
  refund_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_req_order ON refund_request (order_id);
CREATE INDEX IF NOT EXISTS idx_refund_req_status ON refund_request (status);
-- 同一订单同时只允许一条待处理申请：否则商家会重复退款
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_req_pending
  ON refund_request (order_id) WHERE status = 'pending';

COMMENT ON COLUMN refund_request.source IS 'customer=买家申请，merchant=商家主动退款';
COMMENT ON COLUMN refund_request.refund_id IS 'payment.refund.id；未执行退款时为空';
