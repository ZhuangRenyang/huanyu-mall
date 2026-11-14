import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 订单导出 CSV（ADR-057）。
 *
 * 这一条守的是「表格能被人和 Excel 正确读出来」：
 * 1. 必须带 BOM（否则 Excel 打开中文全乱码）；
 * 2. 逗号/引号/换行要转义，否则一行裂成好几列，对账全部错位；
 * 3. 顾客写的内容不能变成 Excel 公式（CSV 注入）；
 * 4. 筛选条件与列表一致；超上限要明确拒绝，不能悄悄截断。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  deps.state.orderCreated = true;
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const admin = { authorization: "Bearer admin" };

/** 取 CSV 的正文（去掉 BOM），按行切开便于断言。 */
function csvLines(body: string): string[] {
  return body.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
}

describe("订单导出", () => {
  it("未登录 → 401（导出的是全店订单与收货信息）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders/export" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("返回 CSV：带 BOM、附件头、表头 24 列，且含订单号与金额", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders/export", headers: admin });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(String(res.headers["content-disposition"])).toContain("attachment");

      // BOM：Excel 认它才不乱码
      expect(res.body.startsWith("\uFEFF")).toBe(true);
      const lines = csvLines(res.body);
      expect(lines[0]?.split(",")).toHaveLength(24);
      expect(lines[0]).toContain("订单号");
      expect(lines[0]).toContain("运单号");

      const row = lines[1] ?? "";
      expect(row).toContain("ord_1");
      // 金额导出成「元 + 币种」，不是裸的分
      expect(row).toContain("107.00 CNY");
      // 运单从履约模块批量取回
      expect(row).toContain("SF1");
    });
  });

  it("逗号与引号被转义：顾客留言里的逗号不会多切一列", async () => {
    await withApp(async (app, deps) => {
      // 留言含逗号 + 引号：不转义就会裂列
      deps.state.orderCustomerNote = '送货前打电话，别放"快递柜"';
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders/export", headers: admin });
      const row = csvLines(res.body)[1] ?? "";
      expect(row).toContain('"送货前打电话，别放""快递柜"""');
      // 转义正确时该行仍是 24 列（简单计数：未闭合引号内的逗号不算）
      expect(countColumns(row)).toBe(24);
    });
  });

  it("CSV 注入：以 = 开头的单元格加单引号，不会被 Excel 当公式执行", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCustomerNote = "=1+1";
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders/export", headers: admin });
      const row = csvLines(res.body)[1] ?? "";
      expect(row).toContain("'=1+1");
      expect(row).not.toMatch(/,=1\+1/);
    });
  });

  it("日期筛选与列表同一套条件：未来的日期范围导出只有表头", async () => {
    await withApp(async (app) => {
      const future = `${new Date().getFullYear() + 1}-01-01`;
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/export?from=${future}`,
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      expect(csvLines(res.body)).toHaveLength(1);
    });
  });

  it("超过上限 → 400 并说清怎么缩小（不静默截断）", async () => {
    await withApp(async (app, deps) => {
      deps.state.ordersTotalOverride = 5001;
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders/export", headers: admin });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("5000");
    });
  });
});

/** 数一行 CSV 的列数（双引号内的逗号不算分隔符）。 */
function countColumns(line: string): number {
  let cols = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) cols++;
  }
  return cols;
}
