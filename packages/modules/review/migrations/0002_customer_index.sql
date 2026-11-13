-- M-review 0002：顾客维度索引（ADR-054「我的评价」）。
--
-- 顾客在账户页要看自己写过的评价，按时间倒序翻页。
-- 已有索引是 (product_id, created_at) 与 (created_at)，
-- 按 customer_id 查会走全表扫 —— 评价一多，账户页首屏就慢给顾客看。

CREATE INDEX IF NOT EXISTS idx_product_review_customer
  ON product_review (customer_id, created_at DESC)
  WHERE deleted_at IS NULL;
