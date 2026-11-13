import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import * as schema from "./models/index.js";
import { DrizzleReviewRepository } from "./repositories/review.repository.js";
import { ReviewService } from "./services/review.service.js";
import type { ReviewOrderPort } from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export { ReviewService, maskName } from "./services/review.service.js";

/**
 * M-review（商品评价，ADR-042）。
 *
 * 订单数据通过端口注入（组合根注册 "review-order-port"），
 * 模块本身不依赖 order：模块图不新增边，测试给内存端口即可。
 */
export default Module("review", {
  service: (ctx) =>
    new ReviewService(
      new DrizzleReviewRepository(createDbFor(ctx.resolve<Pool>("pool"), schema)),
      ctx.resolve<ReviewOrderPort>("review-order-port"),
    ),
  migrations: ["migrations/0001_init.sql", "migrations/0002_customer_index.sql"],
});
