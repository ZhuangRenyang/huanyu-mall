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
  async findLevelsByItemIds(itemIds: string[]): Promise<InventoryLevelDTO[]> {
    return [...this.levels.values()].filter((l) => itemIds.includes(l.inventory_item_id));
  }
  async findLevel(itemId: string, locationId: string): Promise<InventoryLevelDTO | null> {
    return this.levels.get(`${itemId}:${locationId}`) ?? null;
  }
  async updateLevel(
    levelId: string,
    patch: { stockedQuantity: number; reservedQuantity: number; availableQuantity: number },
  ): Promise<void> {
    for (const l of this.levels.values()) {
      if (l.id === levelId) {
        l.stocked_quantity = patch.stockedQuantity;
        l.reserved_quantity = patch.reservedQuantity;
        l.available_quantity = patch.availableQuantity;
      }
    }
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
    const { service, item, loc } = await setup(10);
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
    void item;
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
});
