-- M06 0007：顾客订单留言（淘宝下单页的「给卖家留言」）。
--
-- 与 merchant_note 分开存，两者可见范围相反，混用会泄露：
--   - customer_note：顾客下单时写，**顾客自己与商家都能看到**，要下发店面；
--   - merchant_note：商家内部备注，**只在后台可见**，永不下发店面（0003）。
--
-- 为什么要建字段而不是塞进 metadata：
--   留言要出现在订单详情、发货单、后台订单页，且要能按它做客服检索；
--   metadata 是自由 JSON，取一次要写一次解析，还会被快照覆盖掉。
--
-- 长度在服务端收到时就截断到 200 字（淘宝同量级），DB 不再加 CHECK：
-- 历史数据里出现超长不该整库写入失败。

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS customer_note text;

COMMENT ON COLUMN "order".customer_note IS '顾客下单留言，顾客与商家均可见（淘宝「给卖家留言」）';
