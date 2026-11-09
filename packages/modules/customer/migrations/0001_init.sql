-- M10 Customer 0001_init（3 表）。手机号仅软标识（不校验）。

CREATE TABLE customer (
  id         text PRIMARY KEY,
  email      text NOT NULL,
  first_name text,
  last_name  text,
  phone      text,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_customer_email ON customer (email) WHERE deleted_at IS NULL;

CREATE TABLE customer_address (
  id                  text PRIMARY KEY,
  customer_id         text NOT NULL REFERENCES customer(id),
  first_name          text NOT NULL,
  last_name           text NOT NULL,
  phone               text,
  line1               text NOT NULL,
  line2               text,
  city                text NOT NULL,
  province            text,
  postal_code         text NOT NULL,
  country_code        char(2) NOT NULL,
  is_default_shipping boolean NOT NULL DEFAULT false,
  is_default_billing  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX idx_addr_customer ON customer_address (customer_id);

CREATE TABLE customer_group (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
