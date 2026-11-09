import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzlePaymentRepository } from "./repositories/payment.repository.js";
import { PaymentService } from "./services/payment.service.js";
import { ProviderRegistry } from "./providers/registry.js";
import { decryptOptions } from "./services/encryption.js";

export * from "./types.js";
export * from "./providers/types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { PaymentService } from "./services/payment.service.js";
export { ProviderRegistry } from "./providers/registry.js";
export { encryptOptions, decryptOptions } from "./services/encryption.js";

export default Module("payment", {
  service: (ctx) => {
    const db = createDbFor(ctx.resolve<Pool>("pool"), schema);
    const repo = new DrizzlePaymentRepository(db);
    // 事件发射端口（可选）：组合根接 EventBus；payment 不依赖 order，支付成功发领域事件
    const emit = ctx.has("payment-events")
      ? ctx.resolve<(event: { name: string; data: Record<string, unknown> }) => Promise<void>>("payment-events")
      : undefined;
    return new PaymentService({
      repo,
      registry: new ProviderRegistry(),
      resolveProviderConfig: async (identifier) => {
        const encrypted = await repo.findProviderConfigEncrypted(identifier);
        return encrypted ? decryptOptions(encrypted) : null;
      },
      emit,
    });
  },
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
