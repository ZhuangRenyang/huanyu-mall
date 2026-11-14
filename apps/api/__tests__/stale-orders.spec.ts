import { describe, expect, it } from "vitest";
import { isStaleUnpaid } from "../src/lib/stale-orders.js";

/** 超时未付款判定（ADR-087）：只碰未付款，边界按分钟。 */
describe("超时未付款判定", () => {
  const now = new Date("2026-11-14T12:00:00.000Z");

  it("满 30 分钟才算超时，差一秒不算", () => {
    expect(isStaleUnpaid("pending", "2026-11-14T11:30:00.000Z", now, 30)).toBe(true);
    expect(isStaleUnpaid("pending", "2026-11-14T11:30:01.000Z", now, 30)).toBe(false);
  });

  it("已付款/已取消/已退款一律不动", () => {
    for (const status of ["paid", "canceled", "refunded", "refund_pending", "fulfilled"]) {
      expect(isStaleUnpaid(status, "2026-11-14T10:00:00.000Z", now, 30)).toBe(false);
    }
  });

  it("缺少下单时间或时间非法时不动", () => {
    expect(isStaleUnpaid("pending", null, now, 30)).toBe(false);
    expect(isStaleUnpaid("pending", "not-a-date", now, 30)).toBe(false);
  });
});
