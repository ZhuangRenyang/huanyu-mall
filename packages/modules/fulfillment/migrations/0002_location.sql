-- M08 Fulfillment 0002_location（ADR-013 §3）：发货单标记所属仓，可按仓拆单。
-- 可空：历史发货单为 null（归入「未标记」）。跨模块禁止外键，故不加 REFERENCES。

ALTER TABLE fulfillment ADD COLUMN stock_location_id text;
