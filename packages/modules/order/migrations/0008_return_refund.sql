-- M06 0008：退货退款（淘宝「退货退款」售后类型）。
--
-- 现状的问题：`refund_request` 只有一种处理方式 —— 商家点「同意」就**立即打款**。
-- 但真实场景里最多的售后是「货已寄到、顾客要退回去」：
-- 钱先退了、货没回来，商家就是净亏一单。淘宝的做法是把这一笔钱拆成两道闸：
--
--   pending ──同意(退货退款)──> awaiting_return   等买家寄回，**不动钱**
--   awaiting_return ──买家填单号──> returned      等商家收货
--   returned ──商家确认收货──> approved           这时才打款
--
-- 而「仅退款」（未发货 / 没收到货）保持原来的一条直路：
--   pending ──同意──> approved（打款）
--
-- 字段说明：
--   resolution  售后类型。历史单据默认 refund_only —— 它们本来就是「同意即退」的语义，
--               补一个默认值比让老数据落进未知分支安全。
--   return_*    退货物流与时间。不放进 metadata：要印在后台列表上、要跟单号检索。

ALTER TABLE refund_request ADD COLUMN IF NOT EXISTS resolution text NOT NULL DEFAULT 'refund_only';
ALTER TABLE refund_request ADD COLUMN IF NOT EXISTS return_carrier text;
ALTER TABLE refund_request ADD COLUMN IF NOT EXISTS return_tracking_number text;
ALTER TABLE refund_request ADD COLUMN IF NOT EXISTS return_shipped_at timestamptz;
ALTER TABLE refund_request ADD COLUMN IF NOT EXISTS return_received_at timestamptz;

COMMENT ON COLUMN refund_request.resolution IS 'refund_only=仅退款（同意即打款）；return_refund=退货退款（收到货才打款）';
COMMENT ON COLUMN refund_request.return_carrier IS '买家退货的物流公司';
COMMENT ON COLUMN refund_request.return_tracking_number IS '买家退货的物流单号';
COMMENT ON COLUMN refund_request.return_shipped_at IS '买家提交退货物流的时间';
COMMENT ON COLUMN refund_request.return_received_at IS '商家确认收到退货的时间';

-- 待买家退货 / 已寄回待收货，都属于「处理中」：同一订单仍然只允许一条在途申请。
-- 原来的唯一索引只约束 status = 'pending'，所以**再补一个**覆盖新状态的（迁移只增不删，
-- 不能 DROP 旧索引）。status 是单值，两条 partial 唯一索引合起来正好等价于
-- 「pending ∪ awaiting_return ∪ returned 里最多一条」，也就挡住了
-- 「等寄回期间再提一张申请 → 商家退两次」这条路。
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_req_return_active
  ON refund_request (order_id)
  WHERE status IN ('awaiting_return', 'returned');
