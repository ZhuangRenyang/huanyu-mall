import { describe, expect, it } from "vitest";
import { fromMinor, getCurrencyExponent, toMinor } from "../src/money/index.js";
import { DomainError } from "../src/errors/domain-error.js";

describe("money（金额最小单位，禁浮点）", () => {
  it("CNY exponent=2 基本换算", () => {
    expect(getCurrencyExponent("CNY")).toBe(2);
    expect(toMinor("12.34", "CNY")).toBe(1234n);
    expect(fromMinor(1234n, "CNY")).toBe("12.34");
  });

  it("JPY exponent=0 无小数", () => {
    expect(getCurrencyExponent("JPY")).toBe(0);
    expect(toMinor("1200", "JPY")).toBe(1200n);
    expect(fromMinor(1200n, "JPY")).toBe("1200");
  });

  it("KWD exponent=3 三位小数", () => {
    expect(getCurrencyExponent("KWD")).toBe(3);
    expect(toMinor("1.234", "KWD")).toBe(1234n);
    expect(fromMinor(1234n, "KWD")).toBe("1.234");
  });

  it("四舍五入（round half away from zero）", () => {
    // JPY 无小数：1.5 → 2，1.4 → 1
    expect(toMinor("1.5", "JPY")).toBe(2n);
    expect(toMinor("1.4", "JPY")).toBe(1n);
    // CNY：1.999 元 = 199.9 分 → 200 分
    expect(toMinor("1.999", "CNY")).toBe(200n);
    expect(toMinor("1.994", "CNY")).toBe(199n);
  });

  it("负数金额", () => {
    expect(toMinor("-12.34", "CNY")).toBe(-1234n);
    expect(fromMinor(-1234n, "CNY")).toBe("-12.34");
  });

  it("非法输入抛 DomainError", () => {
    expect(() => toMinor("abc", "CNY")).toThrow(DomainError);
    expect(() => toMinor("12.34.56", "CNY")).toThrow(DomainError);
    expect(() => toMinor("12.34", "XXX")).toThrow(DomainError);
    expect(() => fromMinor(1n, "XXX")).toThrow(DomainError);
  });
});
