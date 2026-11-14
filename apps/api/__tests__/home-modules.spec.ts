import { describe, expect, it } from "vitest";
import { moveHomeModule, normalizeHomeModules } from "@mall/theme";

/**
 * 首页模块编排（ADR-079）。
 *
 * 归一化是纯函数，边界比正常路径重要：
 * 老配置里有已下线的模块 id、同一 id 重复、新版本新增模块 —— 三种都不能把首页搞崩。
 */
describe("首页模块归一化（ADR-079）", () => {
  it("没有配置 → 默认三个模块全开，顺序固定", () => {
    expect(normalizeHomeModules(null).map((m) => m.id)).toEqual([
      "categories",
      "vouchers",
      "featured",
    ]);
    expect(normalizeHomeModules({}).every((m) => m.enabled)).toBe(true);
  });

  it("保留商家顺序与开关", () => {
    const list = normalizeHomeModules({
      home_modules: [
        { id: "featured", enabled: false },
        { id: "categories", enabled: true },
      ],
    });
    expect(list).toEqual([
      { id: "featured", enabled: false },
      { id: "categories", enabled: true },
      // 缺失的新模块补在末尾并默认开
      { id: "vouchers", enabled: true },
    ]);
  });

  it("未知 id 丢弃、重复 id 只认第一个", () => {
    const list = normalizeHomeModules({
      home_modules: [
        { id: "banner" },
        { id: "featured" },
        { id: "featured", enabled: false },
        { id: "vouchers" },
      ],
    });
    expect(list.map((m) => m.id)).toEqual(["featured", "vouchers", "categories"]);
    expect(list.find((m) => m.id === "featured")?.enabled).toBe(true);
  });

  it("上移/下移越界原样返回", () => {
    const base = normalizeHomeModules(null);
    expect(moveHomeModule(base, "categories", "up")).toEqual(base);
    expect(moveHomeModule(base, "featured", "down")).toEqual(base);
    expect(moveHomeModule(base, "featured", "up").map((m) => m.id)).toEqual([
      "categories",
      "featured",
      "vouchers",
    ]);
  });
});
