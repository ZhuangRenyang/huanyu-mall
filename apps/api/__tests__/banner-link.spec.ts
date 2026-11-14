import { describe, expect, it } from "vitest";
import { normalizeLink } from "@mall/theme";

/** 轮播图链接白名单（ADR-080）：装修入口不能变成 XSS 入口。 */
describe("轮播图链接白名单", () => {
  it("站内路径与 https 放行，其它拒绝", () => {
    expect(normalizeLink("/zh-CN/cn/products")).toBe("/zh-CN/cn/products");
    expect(normalizeLink("https://example.com/p/1")).toBe("https://example.com/p/1");
    expect(normalizeLink("  ")).toBeNull();
    expect(() => normalizeLink("javascript:alert(1)")).toThrow();
    expect(() => normalizeLink("//evil.example.com")).toThrow();
    expect(() => normalizeLink("http://example.com")).toThrow();
  });
});
