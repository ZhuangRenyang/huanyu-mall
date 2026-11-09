import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleAuthRepository } from "./repositories/auth.repository.js";
import { AuthService } from "./services/auth.service.js";
import { Argon2PasswordHasher } from "./services/password.js";
import type { AuthConfig, CustomerPort } from "./types.js";

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
  };
}

interface CustomerLike {
  createCustomer(input: {
    email: string;
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
    });
  },
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
