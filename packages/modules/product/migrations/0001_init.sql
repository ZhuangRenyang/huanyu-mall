-- M01 Product 0001_init（10 表）
-- 约定：id text ULID+前缀；timestamptz UTC；软删 deleted_at + 部分唯一索引；模块内 FK 允许。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE product_type (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE attribute (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  handle          text NOT NULL,
  input_type      text NOT NULL,
  is_filterable   boolean NOT NULL DEFAULT false,
  is_translatable boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX uq_attribute_handle ON attribute (handle) WHERE deleted_at IS NULL;

CREATE TABLE attribute_value (
  id           text PRIMARY KEY,
  attribute_id text NOT NULL REFERENCES attribute(id),
  value        text NOT NULL,
  label        text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX uq_attr_value ON attribute_value (attribute_id, value) WHERE deleted_at IS NULL;

CREATE TABLE product_type_attribute (
  id                  text PRIMARY KEY,
  product_type_id     text NOT NULL REFERENCES product_type(id),
  attribute_id        text NOT NULL REFERENCES attribute(id),
  sort_order          integer NOT NULL DEFAULT 0,
  is_variant_attribute boolean NOT NULL DEFAULT false,
  is_required         boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE UNIQUE INDEX uq_ptype_attr ON product_type_attribute (product_type_id, attribute_id) WHERE deleted_at IS NULL;

CREATE TABLE product (
  id                text PRIMARY KEY,
  title             text NOT NULL,
  handle            text NOT NULL,
  subtitle          text,
  description       text,
  status            text NOT NULL DEFAULT 'draft',
  thumbnail_file_id text,
  product_type_id   text REFERENCES product_type(id),
  metadata          jsonb,
  search_vector     tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(subtitle,''))) STORED,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_product_handle ON product (handle) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_status ON product (status);
CREATE INDEX idx_product_search ON product USING GIN (search_vector);
CREATE INDEX idx_product_title_trgm ON product USING GIN (title gin_trgm_ops);

CREATE TABLE product_variant (
  id              text PRIMARY KEY,
  product_id      text NOT NULL REFERENCES product(id),
  sku             text NOT NULL,
  title           text NOT NULL,
  options         jsonb NOT NULL,
  barcode         text,
  ean             text,
  weight_gram     integer,
  height_mm       integer,
  width_mm        integer,
  length_mm       integer,
  allow_backorder boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX uq_variant_sku ON product_variant (sku) WHERE deleted_at IS NULL;
CREATE INDEX idx_variant_product ON product_variant (product_id);

CREATE TABLE variant_attribute_value (
  id                 text PRIMARY KEY,
  variant_id         text NOT NULL REFERENCES product_variant(id),
  attribute_id       text NOT NULL REFERENCES attribute(id),
  attribute_value_id text NOT NULL REFERENCES attribute_value(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_vav ON variant_attribute_value (variant_id, attribute_id);

CREATE TABLE product_image (
  id         text PRIMARY KEY,
  product_id text NOT NULL REFERENCES product(id),
  file_id    text NOT NULL,
  alt        text,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_pimg_product ON product_image (product_id);

CREATE TABLE product_category (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  handle     text NOT NULL,
  parent_id  text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_cat_handle ON product_category (handle) WHERE deleted_at IS NULL;
CREATE INDEX idx_cat_parent ON product_category (parent_id);

CREATE TABLE product_category_link (
  id          text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES product(id),
  category_id text NOT NULL REFERENCES product_category(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_pcat ON product_category_link (product_id, category_id);
