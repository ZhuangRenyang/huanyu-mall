-- M11 Auth 0003：顾客注册方式（ADR-025）。
--
-- 两种注册方式都是成熟做法，选哪种取决于店铺面向谁：
--   email：独立站 / 海外（Shopify 做法）—— 邮箱 + 密码，手机号也必填并验证；
--   phone：国内市场（淘宝做法）—— 手机号 + 验证码，注册即登录。
-- 不写死在代码里，做成店铺级设置，由商家在后台「设置 → 顾客账号」切换。
--
-- 默认 email：独立站起手最稳（顾客没有手机号也能下单前先有账号体系）。

CREATE TABLE IF NOT EXISTS auth_settings (
  id            text PRIMARY KEY,
  /** email | phone */
  register_mode text NOT NULL DEFAULT 'email',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auth_settings (id) VALUES ('auth_default')
ON CONFLICT (id) DO NOTHING;
