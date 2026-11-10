import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleCartRepository } from "./repositories/cart.repository.js";
import { CartService } from "./services/cart.service.js";
import type {
  PricingLookupPort,
  ProductLookupPort,
  PromotionLookupPort,
  ShippingLookupPort,
} from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { CartService } from "./services/cart.service.js";

export default Module("cart", {
  service: (ctx) =>
    new CartService({
      repo: new DrizzleCartRepository(createDbFor(ctx.resolve<Pool>("pool"), schema)),
      // 跨模块走端口：加购时后端自行解析变体与价格（铁律 13）
      product: ctx.resolve<ProductLookupPort>("product"),
      pricing: ctx.resolve<PricingLookupPort>("pricing"),
      // 选运费时后端回填方案名与运费金额
      shipping: ctx.resolve<ShippingLookupPort>("fulfillment"),
      // 目录促销行级折扣：后端算金额（铁律 13）
      promotion: ctx.resolve<PromotionLookupPort>("promotion"),
    }),
  migrations: ["migrations/0001_init.sql", "migrations/0002_voucher_codes.sql"],
  linkable,
});
