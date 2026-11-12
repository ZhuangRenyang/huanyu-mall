-- M11 Auth 0002：手机号注册 / 验证码登录（对齐淘宝）。
--
-- 淘宝的顾客主体是**手机号**：手机号 + 短信验证码注册，注册即登录；邮箱是后来绑定的。
-- 因此 email 必须允许为空 —— 现在它是 NOT NULL，手机号用户根本建不出来。
--
-- 唯一性：
--   * email 仍唯一（部分索引，NULL 不参与）；
--   * phone 唯一（部分索引）—— 一个手机号只能对应一个登录身份，
--     否则「用手机号登录」会查出两个账号，取谁都错。
--
-- 兜底约束：email 与 phone 至少要有一个，否则这条身份无法登录。

ALTER TABLE auth_identity ALTER COLUMN email DROP NOT NULL;
ALTER TABLE auth_identity ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE auth_identity ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_phone
  ON auth_identity (phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE auth_identity
  ADD CONSTRAINT ck_auth_identity_contact
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- 验证码：只存哈希，不存明文；过期时间与尝试次数都由服务端管。
CREATE TABLE IF NOT EXISTS verification_code (
  id          text PRIMARY KEY,
  channel     text NOT NULL,
  target      text NOT NULL,
  purpose     text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_target
  ON verification_code (target, purpose, created_at DESC);

COMMENT ON TABLE verification_code IS '短信/邮箱验证码：只存哈希，一次性消费';
