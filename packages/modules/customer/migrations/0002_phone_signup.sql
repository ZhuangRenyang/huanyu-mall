-- M10 Customer 0002：手机号注册（email 可空）。
--
-- 手机号注册的顾客没有邮箱，而 customer.email 现在是 NOT NULL —— 建不出客户档案。
-- 邮箱改为可空；手机号加索引（客户列表按手机号搜、注册查重都会用到）。
--
-- 唯一性放在 auth_identity 上（登录主体），customer 只是资料表，
-- 不在资料表上再建一套唯一约束 —— 两处约束迟早会打架。

ALTER TABLE customer ALTER COLUMN email DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_phone
  ON customer (phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;
