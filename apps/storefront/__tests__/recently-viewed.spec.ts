/**
 * 浏览足迹（ADR-063）。
 *
 * 这一条最容易错的地方不是界面，而是**存进去什么、怎么去重**：
 * - 同一商品反复回看会把列表刷满同一件（顾客找不到别的东西）；
 * - 脏数据直接渲染会让整块白掉（localStorage 是用户可改的，不能当可信来源）。
 */
import { describe, expect, it } from "vitest";
import {
  RECENT_LIMIT,
  clearRecent,
  listRecent,
  mergeRecent,
  recordView,
  type RecentView,
  type RecentStorage,
} from "../lib/recently-viewed";

/** 内存版存储，用来测读写与容错（不碰真 localStorage）。 */
function memoryStorage(initial: string | null = null): RecentStorage & { readonly raw: string | null } {
  let value = initial;
  return {
    get: () => value,
    set: (v: string) => {
      value = v;
    },
    remove: () => {
      value = null;
    },
    get raw() {
      return value;
    },
  };
}

function item(overrides: Partial<RecentView> = {}): RecentView {
  return {
    productId: "prod_1",
    handle: "mouse",
    title: "无线静音鼠标",
    priceMinor: 19900,
    currencyCode: "CNY",
    viewedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("足迹合并：同商品只留一条", () => {
  it("重复查看同一商品：不新增，顶到最前并更新时间", () => {
    const older = item({ viewedAt: 100 });
    const other = item({ productId: "prod_2", handle: "keyboard", viewedAt: 200 });
    const again = item({ viewedAt: 300 });

    const merged = mergeRecent([older, other], again);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.productId).toBe("prod_1");
    expect(merged[0]?.viewedAt).toBe(300);
    // 另一件仍在，位置后移
    expect(merged[1]?.productId).toBe("prod_2");
  });

  it("超过上限时丢最旧的", () => {
    const list = Array.from({ length: RECENT_LIMIT }, (_, i) =>
      item({ productId: `prod_${i}`, viewedAt: i }),
    );
    const merged = mergeRecent(list, item({ productId: "prod_new", viewedAt: 999 }));
    expect(merged).toHaveLength(RECENT_LIMIT);
    expect(merged[0]?.productId).toBe("prod_new");
    // 最旧的那条被挤掉
    expect(merged.some((v) => v.productId === `prod_${RECENT_LIMIT - 1}`)).toBe(false);
  });
});

describe("足迹读写", () => {
  it("写一条能读回，字段完整", () => {
    const storage = memoryStorage();
    recordView(item(), storage);
    const list = listRecent(storage);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ productId: "prod_1", handle: "mouse", priceMinor: 19900 });
  });

  it("清空后读出空数组", () => {
    const storage = memoryStorage();
    recordView(item(), storage);
    clearRecent(storage);
    expect(listRecent(storage)).toEqual([]);
  });

  it("存储里是坏 JSON：当作没有足迹，不抛错（不能因此白屏）", () => {
    const storage = memoryStorage("{不是 JSON");
    expect(listRecent(storage)).toEqual([]);
  });

  it("存储里不是数组：忽略", () => {
    const storage = memoryStorage(JSON.stringify({ productId: "prod_1" }));
    expect(listRecent(storage)).toEqual([]);
  });

  it("缺关键字段的旧数据被丢掉，好的那条保留", () => {
    const storage = memoryStorage(
      JSON.stringify([
        { productId: "prod_1", handle: "mouse", title: "鼠标", priceMinor: 19900, viewedAt: 1 },
        // 缺 handle 与 viewedAt
        { productId: "prod_2", title: "键盘", priceMinor: 29900 },
        null,
        "乱七八糟",
      ]),
    );
    const list = listRecent(storage);
    expect(list).toHaveLength(1);
    expect(list[0]?.productId).toBe("prod_1");
  });

  it("存储写入失败不抛错（隐私模式/配额满时浏览不该中断）", () => {
    const throwing: RecentStorage = {
      get: () => null,
      set: () => {
        throw new Error("QuotaExceededError");
      },
      remove: () => undefined,
    };
    // recordView 内部 set 抛错时不能被吞到调用方炸页面 —— 这里要求它不抛
    expect(() => recordView(item(), throwing)).not.toThrow();
  });
});
