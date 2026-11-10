-- M05 Order 0002_order_discount（阶段 3）：订单折扣留痕（资金安全硬约束 5）。
-- 不可变流水：记录「哪笔订单、哪个促销、给了多少钱」。只增不删。
-- type 枚举 'catalogue' | 'order' | 'voucher' | 'gift_card'（本阶段只写 catalogue 与 order）。

CREATE TABLE order_discount (
  id           text PRIMARY KEY,
  order_id     text NOT NULL REFERENCES "order"(id),
  promotion_id text NOT NULL,
  code         text,
  amount_minor bigint NOT NULL,
  type         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_discount_order ON order_discount (order_id);
