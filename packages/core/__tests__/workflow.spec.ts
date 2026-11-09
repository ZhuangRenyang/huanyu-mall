import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger/index.js";
import { WorkflowEngine } from "../src/workflow/engine.js";
import { WorkflowRegistry } from "../src/workflow/registry.js";
import {
  defineStep,
  defineWorkflow,
  StepResponse,
  TransientError,
  WorkflowFailedError,
} from "../src/workflow/types.js";
import { registerCartCompleteSteps, cartCompleteWorkflow } from "../src/workflow/examples/cart-complete.js";
import { InMemoryDeadLetter, InMemoryJournal } from "./helpers/in-memory-journal.js";

interface DemoStore {
  orders: string[];
  reservations: string[];
  compensated: string[];
}

function makeStore(): DemoStore {
  return { orders: [], reservations: [], compensated: [] };
}

const createOrderStep = defineStep({
  id: "demo.create-order",
  compensationClass: "R",
  async invoke(input: { orderId: string }, ctx) {
    ctx.resolve<DemoStore>("demoStore").orders.push(input.orderId);
    return new StepResponse({ orderId: input.orderId }, input.orderId);
  },
  async compensate(orderId: string, ctx) {
    const s = ctx.resolve<DemoStore>("demoStore");
    s.orders = s.orders.filter((x) => x !== orderId);
    s.compensated.push("demo.create-order");
  },
});

const reserveStep = defineStep({
  id: "demo.reserve",
  compensationClass: "R",
  async invoke(input: { reservationId: string }, ctx) {
    ctx.resolve<DemoStore>("demoStore").reservations.push(input.reservationId);
    return new StepResponse({}, input.reservationId);
  },
  async compensate(reservationId: string, ctx) {
    const s = ctx.resolve<DemoStore>("demoStore");
    s.reservations = s.reservations.filter((x) => x !== reservationId);
    s.compensated.push("demo.reserve");
  },
});

const failStep = defineStep({
  id: "demo.fail",
  compensationClass: "R",
  async invoke() {
    throw new Error("boom");
  },
});

const transientStep = defineStep({
  id: "demo.transient",
  compensationClass: "R",
  retry: { maxAttempts: 3, baseMs: 1, maxMs: 1, jitter: false },
  async invoke() {
    throw new TransientError("upstream down");
  },
});

function makeEngine(store: DemoStore) {
  const journal = new InMemoryJournal();
  const deadLetter = new InMemoryDeadLetter();
  const registry = new WorkflowRegistry();
  for (const s of [createOrderStep, reserveStep, failStep, transientStep]) registry.registerStep(s);
  const engine = new WorkflowEngine({
    journal,
    deadLetter,
    registry,
    logger: createLogger({ level: "silent" }),
    resolve: (name) => (name === "demoStore" ? store : undefined),
  });
  return { engine, journal, deadLetter, registry };
}

describe("WorkflowEngine（架构 §5.5 / §5.8）", () => {
  it("一步失败 → 补偿回滚后行数回到基线", async () => {
    const store = makeStore();
    const { engine, journal } = makeEngine(store);

    const wf = defineWorkflow({ id: "demo.complete" }, async (ctx) => {
      await ctx.step(createOrderStep, { orderId: "ord_1" });
      await ctx.step(reserveStep, { reservationId: "rsv_1" });
      await ctx.step(failStep, {});
    });

    await expect(engine.run(wf, {}, { idempotencyKey: "demo-key-1" })).rejects.toThrow(WorkflowFailedError);

    expect(store.orders).toEqual([]);
    expect(store.reservations).toEqual([]);
    const exec = await journal.findExecution("demo.complete", "demo-key-1");
    expect(exec?.status).toBe("failed");
  });

  it("一步失败 → 逆序补偿（seq DESC）", async () => {
    const store = makeStore();
    const { engine } = makeEngine(store);

    const wf = defineWorkflow({ id: "demo.complete2" }, async (ctx) => {
      await ctx.step(createOrderStep, { orderId: "ord_1" });
      await ctx.step(reserveStep, { reservationId: "rsv_1" });
      await ctx.step(failStep, {});
    });

    await expect(engine.run(wf, {})).rejects.toThrow(WorkflowFailedError);
    expect(store.compensated).toEqual(["demo.reserve", "demo.create-order"]);
  });

  it("幂等重放：同 idempotencyKey 不重复执行", async () => {
    const store = makeStore();
    const { engine } = makeEngine(store);
    let invocations = 0;

    const countingStep = defineStep({
      id: "demo.count",
      compensationClass: "R",
      async invoke(input: { n: number }, ctx) {
        invocations += 1;
        ctx.resolve<DemoStore>("demoStore").orders.push(`ord_${input.n}`);
        return new StepResponse({ n: input.n }, `ord_${input.n}`);
      },
      async compensate(orderId: string, ctx) {
        ctx.resolve<DemoStore>("demoStore").orders = ctx.resolve<DemoStore>("demoStore").orders.filter((x) => x !== orderId);
      },
    });
    const registry = new WorkflowRegistry();
    registry.registerStep(countingStep);
    const journal = new InMemoryJournal();
    const engine2 = new WorkflowEngine({
      journal,
      deadLetter: new InMemoryDeadLetter(),
      registry,
      logger: createLogger({ level: "silent" }),
      resolve: (name) => (name === "demoStore" ? store : undefined),
    });

    const wf = defineWorkflow({ id: "demo.count-wf" }, async (ctx) => {
      return ctx.step(countingStep, { n: 1 });
    });

    const r1 = await engine2.run(wf, {}, { idempotencyKey: "key-1" });
    const r2 = await engine2.run(wf, {}, { idempotencyKey: "key-1" });

    expect(invocations).toBe(1);
    expect(r1.result).toEqual(r2.result);
    expect(r1.executionId).toBe(r2.executionId);
    expect(store.orders).toEqual(["ord_1"]);
  });

  it("可重试错误耗尽重试后进死信", async () => {
    const store = makeStore();
    const { engine, deadLetter, journal } = makeEngine(store);

    const wf = defineWorkflow({ id: "demo.transient-wf" }, async (ctx) => {
      await ctx.step(transientStep, {});
    });

    await expect(engine.run(wf, {})).rejects.toThrow(WorkflowFailedError);

    expect(deadLetter.entries).toHaveLength(1);
    expect(deadLetter.entries[0]?.kind).toBe("workflow");
    expect(deadLetter.entries[0]?.stepId).toBe("demo.transient");
    expect(deadLetter.entries[0]?.attempts).toBe(3);
  });

  it("示例 workflow 注册（cart-complete 模板）", () => {
    const registry = new WorkflowRegistry();
    registerCartCompleteSteps(registry);
    expect(registry.getWorkflow("cart-complete")).toBe(cartCompleteWorkflow);
    expect(registry.getStep("cart-complete.create-order")).toBeDefined();
    expect(registry.getStep("cart-complete.authorize-payment")).toBeDefined();
  });
});
