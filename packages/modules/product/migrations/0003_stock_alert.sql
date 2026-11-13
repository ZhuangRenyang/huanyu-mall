-- M08 0003：到货提醒（ADR-059）。
--
-- 售罄商品页此前是个死胡同：顾客看到「已售罄」，能做的只有关页面。
-- 淘宝在售罄商品上给「到货提醒」——登记后补货时发一封邮件，把一个已经流失的访客
-- 变回可成交的订单。这是转化链条上最便宜的一环，却一直缺着。
--
-- 为什么不放进 customer 模块：
--   提醒是「商品 × 人」的关系，主体是商品（商品下架、变体删除时提醒跟着失效）；
--   customer 只知道顾客，不知道变体。放 product 侧只需存 email + customer_id 两个标量，
--   不新增模块依赖边。
--
-- 为什么允许游客登记：
--   售罄页面的大部分访客没有账号。要求先注册才提醒，等于把提醒本身也关掉了。
--   唯一键按 (variant_id, email) 收敛，同一人重复点只会有一条。

CREATE TABLE IF NOT EXISTS stock_alert (
  id            text PRIMARY KEY,
  product_id    text NOT NULL,
  variant_id    text NOT NULL,
  email         text NOT NULL,
  /** 登录顾客的 id；游客为 null（不建跨模块外键）。 */
  customer_id   text,
  /** 已发过到货通知的时间；null = 还没通知（补货时要发的那批）。 */
  notified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 同一变体 + 同一邮箱只登记一次（重复点「到货提醒」是常态，不是错误）
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_alert_variant_email
  ON stock_alert (variant_id, email);

-- 补货通知：按变体取「还没通知过」的那批
CREATE INDEX IF NOT EXISTS idx_stock_alert_pending
  ON stock_alert (variant_id)
  WHERE notified_at IS NULL;

COMMENT ON COLUMN stock_alert.notified_at IS '已发到货通知的时间；null 表示待通知';
