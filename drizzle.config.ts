import { defineConfig } from "drizzle-kit";

// 迁移唯一事实来源：手写 .sql 增量迁移（架构 §1.2 不变式 7）。
// drizzle-kit 仅用于 generate 出 SQL，禁 push（Spec §4）。
export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/core/src/db/schema.ts",
  out: "./packages/core/migrations",
  strict: true,
  verbose: true,
});
