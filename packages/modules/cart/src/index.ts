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
  TaxLookupPort,
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
      // 税：按顾客收货国家解析税率（ADR-018）
      tax: ctx.resolve<TaxLookupPort>("tax"),
      /*
       * 会员折扣（ADR-102）：等级在客户域、累计消费在订单域。
       *
       * 这里用结构性类型取两个模块的窄接口，而不是 import 它们的类型 ——
       * 购物车只需要「问一句打几折」，不该在编译期依赖整个客户/订单模块。
       */
      membership: {
        getDiscountBps: async (customerId: string) => {
          const orders = ctx.resolve<{
            summarizeByCustomerIds(
              ids: string[],
            ): Promise<Array<{ total_spent_minor: bigint }>>;
          }>("order");
          const sums = await orders.summarizeByCustomerIds([customerId]);
          const spent = sums[0]?.total_spent_minor ?? 0n;
          const customers = ctx.resolve<{
            getMemberDiscountBps(spendMinor: bigint): Promise<number>;
          }>("customer");
          return customers.getMemberDiscountBps(spent);
        },
      },
    }),
  migrations: ["migrations/0001_init.sql", "migrations/0002_voucher_codes.sql", "migrations/0003_gift_card_codes.sql", "migrations/0004_shipping_country.sql",
    "migrations/0005_points.sql"],
  linkable,
});
