import { describe, expect, it } from "vitest";
import { Container } from "../src/container/container.js";
import { topologicalSort } from "../src/container/topo-sort.js";

describe("container（自研 DI）", () => {
  it("singleton 缓存", () => {
    const c = new Container();
    let calls = 0;
    c.register("svc", () => {
      calls++;
      return { value: calls };
    });
    const a = c.resolve<{ value: number }>("svc");
    const b = c.resolve<{ value: number }>("svc");
    expect(a).toBe(b);
    expect(a.value).toBe(1);
  });

  it("transient 每次新建", () => {
    const c = new Container();
    c.register("svc", () => ({ n: Math.random() }), { lifecycle: "transient" });
    expect(c.resolve("svc")).not.toBe(c.resolve("svc"));
  });

  it("重复注册抛错", () => {
    const c = new Container();
    c.register("a", () => 1);
    expect(() => c.register("a", () => 2)).toThrow(/Duplicate/);
  });

  it("启动顺序 = 依赖拓扑序", () => {
    const c = new Container();
    c.register("a", () => 1, { dependencies: ["b", "c"] });
    c.register("b", () => 2, { dependencies: ["c"] });
    c.register("c", () => 3);
    const order = c.startupOrder();
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });

  it("环检测抛错", () => {
    const c = new Container();
    c.register("a", () => 1, { dependencies: ["b"] });
    c.register("b", () => 2, { dependencies: ["a"] });
    expect(() => c.startupOrder()).toThrow(/Circular/);
  });
});

describe("topologicalSort", () => {
  it("未知依赖抛错", () => {
    expect(() =>
      topologicalSort(["a"], new Map([["a", ["missing"]]])),
    ).toThrow(/Unknown dependency/);
  });
});
