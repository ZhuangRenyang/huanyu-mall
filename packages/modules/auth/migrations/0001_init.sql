-- M11 Auth 0001_init（7 表）。ADR-007：JWT 15min + refresh 轮换 + DB revoked_at + RBAC 两档。
-- refresh_token 只存哈希（不存明文）。

CREATE TABLE auth_identity (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  scope         text NOT NULL DEFAULT 'customer',
  customer_id   text,
  admin_user_id text,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX uq_auth_identity_email ON auth_identity (email) WHERE deleted_at IS NULL;

CREATE TABLE auth_credential (
  id               text PRIMARY KEY,
  auth_identity_id text NOT NULL UNIQUE REFERENCES auth_identity(id),
  password_hash    text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_identity (
  id               text PRIMARY KEY,
  auth_identity_id text NOT NULL REFERENCES auth_identity(id),
  provider         text NOT NULL,
  provider_subject text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_provider_subject ON provider_identity (provider, provider_subject);

CREATE TABLE refresh_token (
  id               text PRIMARY KEY,
  auth_identity_id text NOT NULL REFERENCES auth_identity(id),
  token_hash       text NOT NULL,
  scope            text NOT NULL,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  replaced_by      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_refresh_token_hash ON refresh_token (token_hash);
CREATE INDEX idx_rt_identity ON refresh_token (auth_identity_id);

CREATE TABLE admin_user (
  id         text PRIMARY KEY,
  email      text NOT NULL,
  name       text,
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_admin_user_email ON admin_user (email) WHERE deleted_at IS NULL;

CREATE TABLE rbac_role (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  permissions jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_rbac_role_name ON rbac_role (name) WHERE deleted_at IS NULL;

CREATE TABLE rbac_user_role (
  id            text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_user(id),
  rbac_role_id  text NOT NULL REFERENCES rbac_role(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_rbac_user_role ON rbac_user_role (admin_user_id, rbac_role_id);
