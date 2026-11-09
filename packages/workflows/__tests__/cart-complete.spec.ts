import { describe, expect, it } from "vitest";
import { createLogger, WorkflowEngine, WorkflowFailedError } from "@mall/core";
import {
  cartCompleteWorkflow,
  createWorkflowRegistry,
  type CartCompleteInput,
  type InventoryPort,
  type OrderPort,
  type PaymentPort,
} from "../src/index.js";
import { InMemoryDeadLetter, InMemoryJournal } from "./helpers/in-memory-journal.js";

interface Store {
  orders: Map<string, { lineCount: number }>;
  reservations: Map<string, number>;
}

function makePorts(store: Store, opts: { failPayment?: boolean } = {}) {
  let counter = 0;
  const order: OrderPort = {
    async createOrder(input) {
      const id = `ord_${++counter}`;
      store.orders.set(id, { lineCount: input.items.length });
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
  return { order, inventory, payment };
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
      name === "order" ? ports.order : name === "inventory" ? ports.inventory : name === "payment" ? ports.payment : undefined,
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
    const store: Store = { orders: new Map(), reservations: new Map() };
    const ports = makePorts(store);
    const { engine } = makeEngine(ports);

    const r = await engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-ok" });
    expect(r.result.orderId).toMatch(/^ord_/);
    expect(store.orders.size).toBe(1);
    expect(store.reservations.size).toBe(1);
  });

  it("第三步（支付集合）失败 → 订单行与预留双回滚到基线", async () => {
    const store: Store = { orders: new Map(), reservations: new Map() };
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
    const store: Store = { orders: new Map(), reservations: new Map() };
    const ports = makePorts(store);
    const { engine } = makeEngine(ports);

    const r1 = await engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-idem" });
    const r2 = await engine.run(cartCompleteWorkflow, input, { idempotencyKey: "k-idem" });
    expect(r2.executionId).toBe(r1.executionId);
    expect(store.orders.size).toBe(1);
  });
});
