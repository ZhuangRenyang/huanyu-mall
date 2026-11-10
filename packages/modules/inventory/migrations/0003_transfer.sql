-- M07 Inventory 0003_transfer（ADR-013 §4）：仓间调拨独立流水，不动预留。
-- 同模块内允许外键；跨模块仍禁止。

CREATE TABLE inventory_transfer (
  id                text PRIMARY KEY,
  from_location_id  text NOT NULL REFERENCES stock_location(id),
  to_location_id    text NOT NULL REFERENCES stock_location(id),
  inventory_item_id text NOT NULL REFERENCES inventory_item(id),
  quantity          integer NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  note              text,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_transfer_quantity_positive CHECK (quantity > 0),
  CONSTRAINT ck_transfer_locations_differ CHECK (from_location_id <> to_location_id)
);

CREATE INDEX idx_transfer_from ON inventory_transfer (from_location_id);
CREATE INDEX idx_transfer_to ON inventory_transfer (to_location_id);
CREATE INDEX idx_transfer_item ON inventory_transfer (inventory_item_id);
