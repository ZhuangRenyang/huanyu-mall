/**
 * 「再买一次」（ADR-058）。
 *
 * 这一条最容易错的地方不是按钮，而是**加购用的是哪个 id**：
 * 购物车按变体（variant）管理，同一商品不同规格是两个变体。
 * 拿 productId 去加购，后端会当成一个不存在的变体，或者把两个规格算成一个。
 */
import { describe, expect, it } from "vitest";
import { buyAgainLines, type OrderView } from "../lib/orders";
import { toOrderRecord } from "../lib/checkout";
import type { Order } from "@mall/sdk";

function makeOrder(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "ord_1",
    status: "completed",
    createdAt: Date.now(),
    currencyCode: "CNY",
    items: [],
    subtotalMinor: 0,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    shippingOptionName: "标准快递",
    paymentMethod: "微信支付",
    contactName: "张三",
    contactPhone: "13800000000",
    shippingRegion: "广东省深圳市",
    shippingLine1: "科苑路 15 号",
    timeline: [],
    ...overrides,
  };
}

describe("再买一次：加购行", () => {
  it("按变体 id 输出，数量沿用订单里的数量", () => {
    const { lines, skipped } = buyAgainLines(
      makeOrder({
        items: [
          { productId: "prod_1", variantId: "var_black", title: "鼠标", variantTitle: "黑色", quantity: 2, unitPriceMinor: 19900 },
        ],
      }),
    );
    expect(skipped).toBe(0);
    expect(lines).toEqual([
      { variantId: "var_black", title: "鼠标", variantTitle: "黑色", unitPriceMinor: 19900, quantity: 2 },
    ]);
  });

  it("没有变体 id 的历史行被跳过并计数（不能静默少加）", () => {
    const { lines, skipped } = buyAgainLines(
      makeOrder({
        items: [
          { productId: "prod_1", variantId: "var_a", title: "鼠标", quantity: 1, unitPriceMinor: 19900 },
          // 改造前的订单快照没有 variantId
          { productId: "prod_2", title: "键盘", quantity: 1, unitPriceMinor: 52900 },
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("全部没有变体 id 时不出任何行（按钮据此隐藏）", () => {
    const { lines, skipped } = buyAgainLines(
      makeOrder({ items: [{ title: "旧商品", quantity: 1, unitPriceMinor: 100 }] }),
    );
    expect(lines).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe("再买一次：live 订单映射带上变体 id", () => {
  it("line_items.variant_id 映射到 item.variantId", () => {
    const order = {
      id: "ord_9",
      status: "completed",
      email: "a@b.com",
      currency_code: "CNY",
      subtotal_minor: 19900,
      shipping_minor: 0,
      tax_minor: 0,
      total_minor: 19900,
      line_items: [
        {
          id: "oli_1",
          product_id: "prod_1",
          variant_id: "var_black",
          title: "鼠标",
          sku: "MOUSE-BLK",
          quantity: 1,
          unit_price_minor: 19900,
          tax_rate_bps: 0,
          tax_amount_minor: 0,
          total_minor: 19900,
          currency_code: "CNY",
        },
      ],
    } as unknown as Order;

    const rec = toOrderRecord(order);
    expect(rec.items[0]?.variantId).toBe("var_black");
    expect(rec.items[0]?.productId).toBe("prod_1");
    // 映射对了，「再买一次」才拿得到变体
    expect(buyAgainLines({ ...makeOrder(), items: rec.items }).lines).toHaveLength(1);
  });
});
