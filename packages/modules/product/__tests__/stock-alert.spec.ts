import { describe, expect, it } from "vitest";
import { stockAlertSince } from "../src/services/product.service.js";


describe("到货提醒有效期可配（ADR-089）", () => {
  it("传 7 天就回 7 天；0/负数/NaN 退回默认 30 天", () => {
    const now = new Date("2026-11-14T00:00:00.000Z");
    expect(stockAlertSince(now, 7).toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(stockAlertSince(now, 30).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(stockAlertSince(now, 0).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(stockAlertSince(now, Number.NaN).toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });
});
