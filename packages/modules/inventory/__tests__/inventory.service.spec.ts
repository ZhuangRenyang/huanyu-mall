import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { InventoryService } from "../src/services/inventory.service.js";
import type {
  InventoryItemDTO,
  InventoryLevelDTO,
  InventoryRepository,
  ReservationDTO,
  ReservationStatus,
  StockLocationDTO,
} from "../src/types.js";

class InMemoryInventoryRepository implements InventoryRepository {
  readonly items = new Map<string, InventoryItemDTO>();
  readonly locations = new Map<string, StockLocationDTO>();
  readonly levels = new Map<string, InventoryLevelDTO>();
  readonly reservations = new Map<string, ReservationDTO>();
  readonly variantItem = new Map<string, string>();
  private counter = 0;

  async itemIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    for (const v of variantIds) {
      const i = this.variantItem.get(v);
      if (i) m.set(v, i);
    }
    return m;
  }
  async listItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }> {
    const all = [...this.items.values()];
    return { items: all.slice(q.offset, q.offset + q.limit), count: all.length };
  }
  async findLevelsByItemIds(itemIds: string[]): Promise<InventoryLevelDTO[]> {
    return [...this.levels.values()].filter((l) => itemIds.includes(l.inventory_item_id));
  }
  async listLocations(): Promise<StockLocationDTO[]> {
    return [...this.locations.values()];
  }
  async reservationIdsByOrder(orderId: string): Promise<string[]> {
    return [...this.reservations.values()]
      .filter((r) => r.order_id === orderId && r.status === "reserved")
      .map((r) => r.id);
  }
  async findReservationsByOrder(orderId: string): Promise<ReservationDTO[]> {
    return [...this.reservations.values()].filter(
      (r) => r.order_id === orderId && r.status === "reserved",
    );
  }
  async findLevel(itemId: string, locationId: string): Promise<InventoryLevelDTO | null> {
    return this.levels.get(`${itemId}:${locationId}`) ?? null;
  }
  async findLevelById(levelId: string): Promise<InventoryLevelDTO | null> {
    return [...this.levels.values()].find((l) => l.id === levelId) ?? null;
  }
  /**
   * 模拟数据库「条件 UPDATE」的原子性：检查与写入之间无 await，
   * 等价于单条 SQL 的 WHERE available >= qty 原子生效。
   */
  async tryReserveLevel(levelId: string, quantity: number): Promise<boolean> {
    const level = [...this.levels.values()].find((l) => l.id === levelId);
    if (!level || level.available_quantity < quantity) return false;
    level.reserved_quantity += quantity;
    level.available_quantity -= quantity;
    return true;
  }
  async releaseLevelQuantity(levelId: string, quantity: number): Promise<void> {
    const level = [...this.levels.values()].find((l) => l.id === levelId);
    if (!level) return;
    level.reserved_quantity = Math.max(0, level.reserved_quantity - quantity);
    level.available_quantity = level.stocked_quantity - level.reserved_quantity;
  }
  async commitLevelQuantity(levelId: string, quantity: number): Promise<void> {
    const level = [...this.levels.values()].find((l) => l.id === levelId);
    if (!level) return;
    level.stocked_quantity -= quantity;
    level.reserved_quantity = Math.max(0, level.reserved_quantity - quantity);
    level.available_quantity = level.stocked_quantity - level.reserved_quantity;
  }
  async adjustLevelQuantity(levelId: string, delta: number): Promise<void> {
    const level = [...this.levels.values()].find((l) => l.id === levelId);
    if (!level) return;
    level.stocked_quantity += delta;
    level.available_quantity = level.stocked_quantity - level.reserved_quantity;
  }
  async withTransaction<T>(fn: (repo: InventoryRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async createReservation(input: {
    inventoryItemId: string;
    stockLocationId: string;
    lineItemId: string;
    orderId?: string | null;
    quantity: number;
    workflowRunId?: string | null;
  }): Promise<ReservationDTO> {
    const r: ReservationDTO = {
      id: `rsv_${++this.counter}`,
      inventory_item_id: input.inventoryItemId,
      stock_location_id: input.stockLocationId,
      line_item_id: input.lineItemId,
      order_id: input.orderId ?? null,
      quantity: input.quantity,
      status: "reserved",
      workflow_run_id: input.workflowRunId ?? null,
    };
    this.reservations.set(r.id, r);
    return r;
  }
  async findReservation(id: string): Promise<ReservationDTO | null> {
    return this.reservations.get(id) ?? null;
  }
  async setReservationStatus(id: string, status: ReservationStatus): Promise<void> {
    const r = this.reservations.get(id);
    if (r) r.status = status;
  }
  async createInventoryItem(input: { sku: string; title?: string | null }): Promise<InventoryItemDTO> {
    const i: InventoryItemDTO = { id: `invitem_${++this.counter}`, sku: input.sku, title: input.title ?? null, requires_shipping: true };
    this.items.set(i.id, i);
    return i;
  }
  async createStockLocation(input: { name: string; priority?: number }): Promise<StockLocationDTO> {
    const l: StockLocationDTO = { id: `loc_${++this.counter}`, name: input.name, priority: input.priority ?? 0 };
    this.locations.set(l.id, l);
    return l;
  }
  async createLevel(input: {
    inventoryItemId: string;
    stockLocationId: string;
    stockedQuantity: number;
  }): Promise<InventoryLevelDTO> {
    const l: InventoryLevelDTO = {
      id: `invlvl_${++this.counter}`,
      inventory_item_id: input.inventoryItemId,
      stock_location_id: input.stockLocationId,
      stocked_quantity: input.stockedQuantity,
      reserved_quantity: 0,
      available_quantity: input.stockedQuantity,
    };
    this.levels.set(`${input.inventoryItemId}:${input.stockLocationId}`, l);
    return l;
  }
  async linkVariant(itemId: string, variantId: string): Promise<void> {
    this.variantItem.set(variantId, itemId);
  }
}

async function setup(stocked = 10) {
  const repo = new InMemoryInventoryRepository();
  const service = new InventoryService(repo);
  const item = await repo.createInventoryItem({ sku: "SKU-1" });
  const loc = await repo.createStockLocation({ name: "默认仓" });
  await repo.createLevel({ inventoryItemId: item.id, stockLocationId: loc.id, stockedQuantity: stocked });
  await repo.linkVariant(item.id, "var_1");
  return { repo, service, item, loc };
}

describe("InventoryService（M07，K1 reservation 独立记账）", () => {
  it("getAvailability 返回 variant 级可用量", async () => {
    const { service } = await setup(10);
    const [a] = await service.getAvailability({ variantIds: ["var_1"] });
    expect(a?.available).toBe(10);
    const [missing] = await service.getAvailability({ variantIds: ["var_unknown"] });
    expect(missing?.available).toBe(0);
  });

  it("reserve → release 回滚到基线", async () => {
    const { service, loc } = await setup(10);
    const rsv = await service.reserve({
      variantId: "var_1",
      locationId: loc.id,
      quantity: 3,
      lineItemId: "cli_1",
    });
    expect(rsv.status).toBe("reserved");

    const afterReserve = await service.getAvailability({ variantIds: ["var_1"] });
    expect(afterReserve[0]?.available).toBe(7);

    await service.releaseReservation(rsv.id);
    const afterRelease = await service.getAvailability({ variantIds: ["var_1"] });
    expect(afterRelease[0]?.available).toBe(10);
  });

  it("reserve → commit 出库（stocked/reserved 同减，available 不变）", async () => {
    const { service, repo, item, loc } = await setup(10);
    const rsv = await service.reserve({
      variantId: "var_1",
      locationId: loc.id,
      quantity: 3,
      lineItemId: "cli_1",
    });
    await service.commitReservation(rsv.id);

    const level = repo.levels.get(`${item.id}:${loc.id}`)!;
    expect(level.stocked_quantity).toBe(7);
    expect(level.reserved_quantity).toBe(0);
    expect(level.available_quantity).toBe(7);
    expect(repo.reservations.get(rsv.id)?.status).toBe("committed");
  });

  it("超可用量 reserve 被拒（DomainError 30003）", async () => {
    const { service, loc } = await setup(10);
    await expect(
      service.reserve({ variantId: "var_1", locationId: loc.id, quantity: 11, lineItemId: "cli_1" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("并发 reserve 抢最后 1 件：只有一个成功，不超卖", async () => {
    const { service, repo, item, loc } = await setup(1);
    const results = await Promise.allSettled([
      service.reserve({ variantId: "var_1", locationId: loc.id, quantity: 1, lineItemId: "cli_a" }),
      service.reserve({ variantId: "var_1", locationId: loc.id, quantity: 1, lineItemId: "cli_b" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);

    const level = repo.levels.get(`${item.id}:${loc.id}`)!;
    expect(level.reserved_quantity).toBe(1);
    expect(level.available_quantity).toBe(0);
    expect(repo.reservations.size).toBe(1);
  });

  it("数量非正整数被拒（禁浮点/零/负）", async () => {
    const { service, loc } = await setup(10);
    await expect(
      service.reserve({ variantId: "var_1", locationId: loc.id, quantity: 1.5, lineItemId: "cli_f" }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("InventoryService.allocateAndReserve（ADR-013 多仓分配）", () => {
  /** 两仓：loc_a priority 1 / loc_b priority 2，分别入不同在库量。 */
  async function setupTwoWarehouses(a: number, b: number) {
    const repo = new InMemoryInventoryRepository();
    const service = new InventoryService(repo);
    const item = await repo.createInventoryItem({ sku: "SKU-MULTI" });
    const locA = await repo.createStockLocation({ name: "A 仓", priority: 1 });
    const locB = await repo.createStockLocation({ name: "B 仓", priority: 2 });
    await repo.createLevel({ inventoryItemId: item.id, stockLocationId: locA.id, stockedQuantity: a });
    await repo.createLevel({ inventoryItemId: item.id, stockLocationId: locB.id, stockedQuantity: b });
    await repo.linkVariant(item.id, "var_1");
    return { repo, service, item, locA, locB };
  }

  it("单仓满足：只产生一条预留", async () => {
    const { service, locA } = await setupTwoWarehouses(10, 0);
    const result = await service.allocateAndReserve({
      orderId: "ord_1",
      items: [{ variantId: "var_1", quantity: 3 }],
    });

    expect(result.allocations).toEqual([
      { variantId: "var_1", stockLocationId: locA.id, quantity: 3 },
    ]);
    expect(result.reservationIds).toHaveLength(1);
  });

  it("跨两仓按 priority 拆分：两条预留、两仓各自扣减", async () => {
    const { service, repo, item, locA, locB } = await setupTwoWarehouses(3, 4);
    const result = await service.allocateAndReserve({
      orderId: "ord_2",
      items: [{ variantId: "var_1", quantity: 6 }],
    });

    expect(result.allocations).toEqual([
      { variantId: "var_1", stockLocationId: locA.id, quantity: 3 },
      { variantId: "var_1", stockLocationId: locB.id, quantity: 3 },
    ]);
    expect(result.reservationIds).toHaveLength(2);

    const levelA = repo.levels.get(`${item.id}:${locA.id}`)!;
    const levelB = repo.levels.get(`${item.id}:${locB.id}`)!;
    expect([levelA.reserved_quantity, levelA.available_quantity]).toEqual([3, 0]);
    expect([levelB.reserved_quantity, levelB.available_quantity]).toEqual([3, 1]);
  });

  it("合计不足 → 抛 insufficientStock，且不产生任何预留、库存不动", async () => {
    const { service, repo, item, locA, locB } = await setupTwoWarehouses(2, 3);

    await expect(
      service.allocateAndReserve({ orderId: "ord_3", items: [{ variantId: "var_1", quantity: 6 }] }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(repo.reservations.size).toBe(0);
    expect(repo.levels.get(`${item.id}:${locA.id}`)!.available_quantity).toBe(2);
    expect(repo.levels.get(`${item.id}:${locB.id}`)!.available_quantity).toBe(3);
  });

  it("幂等：同 orderId 重放返回同一批 reservationIds，不重复扣减", async () => {
    const { service, repo, item, locA } = await setupTwoWarehouses(10, 0);
    const first = await service.allocateAndReserve({
      orderId: "ord_4",
      items: [{ variantId: "var_1", quantity: 4 }],
    });
    const second = await service.allocateAndReserve({
      orderId: "ord_4",
      items: [{ variantId: "var_1", quantity: 4 }],
    });

    expect(second.reservationIds).toEqual(first.reservationIds);
    expect(second.allocations).toEqual(first.allocations);
    expect(repo.reservations.size).toBe(1);
    expect(repo.levels.get(`${item.id}:${locA.id}`)!.available_quantity).toBe(6);
  });

  it("整单多 SKU：任一 SKU 不足则整单失败，另一 SKU 也不占用", async () => {
    const { service, repo, item, locA } = await setupTwoWarehouses(10, 0);
    const item2 = await repo.createInventoryItem({ sku: "SKU-2" });
    await repo.createLevel({ inventoryItemId: item2.id, stockLocationId: locA.id, stockedQuantity: 1 });
    await repo.linkVariant(item2.id, "var_2");

    await expect(
      service.allocateAndReserve({
        orderId: "ord_5",
        items: [
          { variantId: "var_1", quantity: 2 },
          { variantId: "var_2", quantity: 5 },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(repo.reservations.size).toBe(0);
    expect(repo.levels.get(`${item.id}:${locA.id}`)!.available_quantity).toBe(10);
    expect(repo.levels.get(`${item2.id}:${locA.id}`)!.available_quantity).toBe(1);
  });
});
