import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleAuthRepository } from "./repositories/auth.repository.js";
import { AuthService } from "./services/auth.service.js";
import { Argon2PasswordHasher } from "./services/password.js";
import type { AuthConfig, CustomerPort, EmailPort, SmsPort } from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { AuthService, type AuthServiceDeps } from "./services/auth.service.js";
export { Argon2PasswordHasher } from "./services/password.js";
export {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  type PasswordStrengthResult,
} from "./services/password-policy.js";
export {
  changeAdminPassword,
  type ChangePasswordDeps,
  type ChangePasswordInput,
} from "./services/change-password.js";
export { signJwt, verifyJwt } from "./services/jwt.js";
export { hashToken, randomToken } from "./services/tokens.js";

function loadAuthConfig(): AuthConfig {
  return {
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
    accessTtlSec: 15 * 60,
    customerRefreshTtlSec: 30 * 24 * 3600,
    adminRefreshTtlSec: 7 * 24 * 3600,
    // 开发环境回传验证码便于自测；生产默认关闭，可用 AUTH_EXPOSE_DEV_CODE=1 显式打开（不推荐）
    exposeDevCode:
      process.env.AUTH_EXPOSE_DEV_CODE === "1" ||
      (process.env.AUTH_EXPOSE_DEV_CODE !== "0" && process.env.NODE_ENV !== "production"),
  };
}

interface CustomerLike {
  createCustomer(input: {
    /** 手机号注册的顾客没有邮箱。 */
    email?: string | null;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }): Promise<{ id: string }>;
}

export default Module("auth", {
  service: (ctx) => {
    const customerService = ctx.resolve<CustomerLike>("customer");
    const customer: CustomerPort = {
      createCustomer: async (input) => ({ customerId: (await customerService.createCustomer(input)).id }),
    };
    return new AuthService({
      repo: new DrizzleAuthRepository(createDbFor(ctx.resolve<Pool>("pool"), schema)),
      hasher: new Argon2PasswordHasher(),
      customer,
      config: loadAuthConfig(),
      // 容器里有 sms 才注入：没有时服务层发码会明确报「通道未配置」
      ...(ctx.has("sms") ? { sms: ctx.resolve<SmsPort>("sms") } : {}),
      // 邮件通道复用通知模块 SMTP；没配 SMTP 时服务层明确报错（开发环境由 API 层降级为日志）
      ...(ctx.has("email") ? { email: ctx.resolve<EmailPort>("email") } : {}),
    });
  },
  migrations: [
    "migrations/0001_init.sql",
    "migrations/0002_phone_login.sql",
    "migrations/0003_settings.sql",
  ],
  linkable,
});
