import { describe, expect, it } from "vitest";
import { isUlid, prefixedUlid, ulid } from "../src/utils/ulid.js";
import { slugify } from "../src/utils/slug.js";
import { isBigInt, isNonEmptyString, isPlainObject, isRecord } from "../src/utils/type-guards.js";

describe("ulid", () => {
  it("长度 26 且字符在 Crockford 字母表内", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it("单调递增（同进程内时间戳维度）", () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a < b).toBe(true);
  });

  it("唯一性", () => {
    const set = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(set.size).toBe(1000);
  });

  it("prefixedUlid 带前缀", () => {
    const id = prefixedUlid("prod");
    expect(id.startsWith("prod_")).toBe(true);
    expect(id).toHaveLength(31); // "prod_" + 26
  });
});

describe("slugify", () => {
  it("基本转换", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Leading & Trailing  ")).toBe("leading-trailing");
  });

  it("保留 Unicode 中文", () => {
    expect(slugify("你好 世界")).toBe("你好-世界");
  });

  it("折叠连续分隔符", () => {
    expect(slugify("a   b___c")).toBe("a-b-c");
  });

  it("空输入返回空串", () => {
    expect(slugify("---")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("type-guards", () => {
  it("isRecord / isPlainObject", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
  });

  it("isNonEmptyString / isBigInt", () => {
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isBigInt(1n)).toBe(true);
    expect(isBigInt(1)).toBe(false);
  });
});
