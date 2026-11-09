-- M07 Inventory 0001_init（4 表）。K1：保留 stock_location 维度 + reservation 独立记账。

CREATE TABLE inventory_item (
  id                text PRIMARY KEY,
  sku               text NOT NULL,
  title             text,
  requires_shipping boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_inventory_item_sku ON inventory_item (sku) WHERE deleted_at IS NULL;

CREATE TABLE stock_location (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  address    jsonb,
  priority   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE inventory_level (
  id                 text PRIMARY KEY,
  inventory_item_id  text NOT NULL REFERENCES inventory_item(id),
  stock_location_id  text NOT NULL REFERENCES stock_location(id),
  stocked_quantity   integer NOT NULL DEFAULT 0,
  reserved_quantity  integer NOT NULL DEFAULT 0,
  available_quantity integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX uq_inventory_level ON inventory_level (inventory_item_id, stock_location_id) WHERE deleted_at IS NULL;

CREATE TABLE reservation_item (
  id                text PRIMARY KEY,
  inventory_item_id text NOT NULL REFERENCES inventory_item(id),
  stock_location_id text NOT NULL REFERENCES stock_location(id),
  line_item_id      text NOT NULL,
  order_id          text,
  quantity          integer NOT NULL,
  status            text NOT NULL DEFAULT 'reserved',
  workflow_run_id   text,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rsv_item ON reservation_item (inventory_item_id, stock_location_id);
CREATE INDEX idx_rsv_status ON reservation_item (status);
CREATE INDEX idx_rsv_expires ON reservation_item (expires_at) WHERE status = 'reserved';
