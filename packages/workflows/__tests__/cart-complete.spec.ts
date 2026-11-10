import { describe, expect, it } from "vitest";
import { createLogger, WorkflowEngine, WorkflowFailedError } from "@mall/core";
import {
  cartCompleteWorkflow,
  createWorkflowRegistry,
  type CartCompleteInput,
  type InventoryPort,
  type OrderPort,
  type PaymentPort,
  type PromotionPort,
} from "../src/index.js";
import { InMemoryDeadLetter, InMemoryJournal } from "./helpers/in-memory-journal.js";

interface Store {
  orders: Map<string, { lineCount: number; discountMinor: bigint; discounts?: CartCompleteInput["discounts"] }>;
  reservations: Map<string, number>;
  consumedCodes: string[];
  releasedCodes: string[];
}

function makePorts(
  store: Store,
  opts: { failPayment?: boolean; failVoucher?: boolean } = {},
) {
  let counter = 0;
  const order: OrderPort = {
    async createOrder(input) {
      const id = `ord_${++counter}`;
      store.orders.set(id, {
        lineCount: input.items.length,
        discountMinor: input.discountMinor ?? 0n,
        discounts: input.discounts,
      });
      return { orderId: id, totalMinor: 19800n };
    },
    async cancelOrder(orderId) {
      store.orders.delete(orderId);
    },
  };
  const inventory: InventoryPort = {
    async reserve(input) {
      const id = `rsv_${++counter}`;
      store.reservations.set(id, input.quantity);
      return { reservationId: id };
    },
    async releaseReservation(id) {
      store.reservations.delete(id);
    },
  };
  const payment: PaymentPort = {
    async createPaymentCollection() {
      if (opts.failPayment) throw new Error("payment provider down");
      return { paymentCollectionId: `paycol_${++counter}` };
    },
  };
  const promotion: PromotionPort = {
    async consumeVoucherCodes(codes) {
      if (opts.failVoucher) throw new Error("voucher limit exceeded");
      store.consumedCodes.push(...codes);
    },
    async releaseVoucherCodes(codes) {
      store.releasedCodes.push(...codes);
    },
  };
  return { order, inventory, payment, promotion };
}

function makeEngine(ports: ReturnType<typeof makePorts>) {
  const journal = new InMemoryJournal();
  const deadLetter = new InMemoryDeadLetter();
  const registry = createWorkflowRegistry();
  const engine = new WorkflowEngine({
    journal,
    deadLetter,
    registry,
    logger: createLogger({ level: "silent" }),
    resolve: (name) =>
      name === "order"
        ? ports.order
        : name === "inventory"
          ? ports.inventory
          : name === "payment"
            ? ports.payment
            : name === "promotion"
              ? ports.promotion
              : undefined,
  });
  return { engine, journal, deadLetter };
}

const input: CartCompleteInput = {
  cartId: "cart_1",
  email: "a@b.com",
  currencyCode: "CNY",
  channelId: "chn_cn",
  regionId: "reg_1",
  shippingAddress: { country: "CN" },
  shippingMinor: 800n,
  items: [
    {
      variantId: "var_1",
      productId: "prod_1",
      title: "T 恤",
      sku: "TEE",
      quantity: 2,
      unitPriceMinor: 9900n,
      locationId: "loc_1",
      snapshot: { title: "T 恤" },
    },
  ],
};

describe("cart-complete workflow（架构 §5.5 / §5.8 L2）", () => {
  it("happy path：订单 + 预留落库，workflow completed", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store);
    const { engine } = makeEngine(ports);

    const r = await engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-ok" });
    expect(r.result.orderId).toMatch(/^ord_/);
    expect(store.orders.size).toBe(1);
    expect(store.reservations.size).toBe(1);
  });

  it("第三步（支付集合）失败 → 订单行与预留双回滚到基线", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store, { failPayment: true });
    const { engine } = makeEngine(ports);

    await expect(engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-fail" })).rejects.toThrow(
      WorkflowFailedError,
    );

    // 订单行回滚（cancelOrder 删除订单） + 预留回滚（releaseReservation）
    expect(store.orders.size).toBe(0);
    expect(store.reservations.size).toBe(0);
  });

  it("幂等重放：同 idempotencyKey 不重复建单", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store);
    const { engine } = makeEngine(ports);

    const r1 = await engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-idem" });
    const r2 = await engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-idem" });
    expect(r2.executionId).toBe(r1.executionId);
    expect(store.orders.size).toBe(1);
  });

  it("discountMinor + discounts 从 input 透传到 OrderPort.createOrder", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store);
    const { engine } = makeEngine(ports);

    const withDiscount: CartCompleteInput = {
      ...input,
      discountMinor: 3980n,
      discounts: [
        { type: "catalogue", promotionId: "promo_cat", code: "CAT", amountMinor: 1980n },
        { type: "order", promotionId: "promo_ord", code: "ORDER20", amountMinor: 2000n },
      ],
    };
    const r = await engine.run(cartCompleteWorkflow, withDiscount, { idempotencyKey: "k-disc" });

    const created = store.orders.get(r.result.orderId);
    expect(created?.discountMinor).toBe(3980n);
    expect(created?.discounts).toEqual(withDiscount.discounts);
  });

  it("voucher 命中：下单成功后 consumeVoucherCodes 核销券码", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store);
    const { engine } = makeEngine(ports);

    const withVoucher: CartCompleteInput = {
      ...input,
      discountMinor: 2000n,
      discounts: [{ type: "voucher", promotionId: "vouch_1", code: "SAVE20", amountMinor: 2000n }],
    };
    await engine.run(cartCompleteWorkflow, withVoucher, { idempotencyKey: "k-vouch" });
    expect(store.consumedCodes).toEqual(["SAVE20"]);
    expect(store.releasedCodes).toEqual([]);
  });

  it("voucher 核销失败（并发超限）→ 订单与预留回滚，无已核销码", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store, { failVoucher: true });
    const { engine } = makeEngine(ports);

    const withVoucher: CartCompleteInput = {
      ...input,
      discountMinor: 2000n,
      discounts: [{ type: "voucher", promotionId: "vouch_1", code: "SAVE20", amountMinor: 2000n }],
    };
    await expect(
      engine.run(cartCompleteWorkflow, withVoucher, { idempotencyKey: "k-vouch-fail" }),
    ).rejects.toThrow(WorkflowFailedError);

    // createOrderStep 已成功 → 补偿 cancelOrder；reserveInventoryStep 尚未执行
    expect(store.orders.size).toBe(0);
    expect(store.reservations.size).toBe(0);
  });

  it("voucher 核销成功后后续步骤失败 → releaseVoucherCodes 回退 used", async () => {
    const store: Store = { orders: new Map(), reservations: new Map(), consumedCodes: [], releasedCodes: [] };
    const ports = makePorts(store, { failPayment: true });
    const { engine } = makeEngine(ports);

    const withVoucher: CartCompleteInput = {
      ...input,
      discountMinor: 2000n,
      discounts: [{ type: "voucher", promotionId: "vouch_1", code: "SAVE20", amountMinor: 2000n }],
    };
    await expect(
      engine.run(cartCompleteWorkflow, withVoucher, { idempotencyKey: "k-vouch-payfail" }),
    ).rejects.toThrow(WorkflowFailedError);

    expect(store.consumedCodes).toEqual(["SAVE20"]);
    expect(store.releasedCodes).toEqual(["SAVE20"]);
    expect(store.orders.size).toBe(0);
    expect(store.reservations.size).toBe(0);
  });
});
