/**
 * 库存域：仓库（stock location）/ 按仓库存行（仓 × SKU）/ 仓间调拨。
 *
 * 后端字段（snake_case）→ 界面视图模型（camelCase）只在这里发生。
 * **可用量一律用后端字段 `available_quantity`，前端不自己算**（ADR-013 §5）。
 *
 * mock 模式：localStorage 种子数据；`completeTransfer` 会真的搬货（源仓减、目标仓加），
 * 便于在不接后端时演示调拨闭环。
 * live 模式：真调 Admin API（RBAC requirePermission("settings")）。
 */
import type { InventoryLevelRow, InventoryTransfer, StockLocation } from '@mall/sdk';
import { adminClient, getAdminApiMode } from './admin-client';

// ------------------------------------------------------------------ *
// 视图模型
// ------------------------------------------------------------------ *

export interface StockLocationView {
  id: string;
  name: string;
  priority: number;
}

export interface InventoryLevelView {
  id: string;
  inventoryItemId: string;
  sku: string;
  locationId: string;
  stocked: number;
  reserved: number;
  available: number;
}

export type TransferStatus = 'pending' | 'completed' | 'cancelled';

export interface TransferView {
  id: string;
  inventoryItemId: string;
  sku: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  status: TransferStatus;
  note: string | null;
  createdAt: string;
}

export interface TransferInput {
  inventoryItemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  note?: string;
}

export interface StockLocationInput {
  name: string;
  priority?: number;
}

// ------------------------------------------------------------------ *
// 映射
// ------------------------------------------------------------------ *

function mapLocation(l: StockLocation): StockLocationView {
  return { id: l.id, name: l.name, priority: l.priority };
}

function mapLevel(l: InventoryLevelRow): InventoryLevelView {
  return {
    id: l.id,
    inventoryItemId: l.inventory_item_id,
    sku: l.sku,
    locationId: l.stock_location_id,
    stocked: l.stocked_quantity,
    reserved: l.reserved_quantity,
    available: l.available_quantity,
  };
}

function mapTransfer(t: InventoryTransfer, sku: string): TransferView {
  return {
    id: t.id,
    inventoryItemId: t.inventory_item_id,
    sku,
    fromLocationId: t.from_location_id,
    toLocationId: t.to_location_id,
    quantity: t.quantity,
    status: t.status,
    note: t.note,
    createdAt: t.created_at,
  };
}

// ------------------------------------------------------------------ *
// mock（localStorage 种子数据）
// ------------------------------------------------------------------ *

const KEYS = {
  locations: 'admin:stock-locations',
  levels: 'admin:inventory-levels',
  transfers: 'admin:inventory-transfers',
} as const;

/** mock 仓 id：订单域造预留明细时也引用（保证两边对得上）。 */
export const MOCK_MAIN_LOCATION_ID = 'loc_main';
export const MOCK_BACKUP_LOCATION_ID = 'loc_backup';

const SEED_LOCATIONS: StockLocationView[] = [
  { id: MOCK_MAIN_LOCATION_ID, name: '主仓', priority: 10 },
  { id: MOCK_BACKUP_LOCATION_ID, name: '备用仓', priority: 5 },
];

/** 种子：主仓 2 个 SKU + 备用仓 1 个 SKU，方便演示「同 SKU 跨仓 + 调拨」。 */
const SEED_LEVELS: InventoryLevelView[] = [
  {
    id: 'ilv_main_ms',
    inventoryItemId: 'itm_ms_blk',
    sku: 'MS-BLK',
    locationId: MOCK_MAIN_LOCATION_ID,
    stocked: 20,
    reserved: 2,
    available: 18,
  },
  {
    id: 'ilv_main_kb',
    inventoryItemId: 'itm_kb_red',
    sku: 'KB-RED',
    locationId: MOCK_MAIN_LOCATION_ID,
    stocked: 8,
    reserved: 0,
    available: 8,
  },
  {
    id: 'ilv_backup_ms',
    inventoryItemId: 'itm_ms_blk',
    sku: 'MS-BLK',
    locationId: MOCK_BACKUP_LOCATION_ID,
    stocked: 4,
    reserved: 0,
    available: 4,
  },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage 不可用 */
  }
}

function newMockId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 4096).toString(36)}`;
}

/** 只用于 mock 种子/搬货后重算可用量（等价后端 `stocked - reserved`）。 */
function withAvailable(level: InventoryLevelView): InventoryLevelView {
  return { ...level, available: level.stocked - level.reserved };
}

function mockLocations(): StockLocationView[] {
  return read<StockLocationView[]>(KEYS.locations, SEED_LOCATIONS);
}

function mockSaveLocations(list: StockLocationView[]): void {
  write(KEYS.locations, list);
}

function mockLevels(): InventoryLevelView[] {
  return read<InventoryLevelView[]>(KEYS.levels, SEED_LEVELS);
}

function mockSaveLevels(list: InventoryLevelView[]): void {
  write(KEYS.levels, list);
}

function mockTransfers(): TransferView[] {
  return read<TransferView[]>(KEYS.transfers, []);
}

function mockSaveTransfers(list: TransferView[]): void {
  write(KEYS.transfers, list);
}

function mockSkuOf(inventoryItemId: string): string {
  return mockLevels().find((l) => l.inventoryItemId === inventoryItemId)?.sku ?? inventoryItemId;
}

// ------------------------------------------------------------------ *
// 对外接口（仓库）
// ------------------------------------------------------------------ *

export async function listStockLocations(): Promise<StockLocationView[]> {
  if (getAdminApiMode() !== 'live') return mockLocations();
  const res = (await adminClient().listStockLocations()) as { items?: StockLocation[] };
  return (res.items ?? []).map(mapLocation);
}

export async function createStockLocation(input: StockLocationInput): Promise<StockLocationView> {
  if (getAdminApiMode() !== 'live') {
    const location: StockLocationView = {
      id: newMockId('loc'),
      name: input.name,
      priority: input.priority ?? 0,
    };
    mockSaveLocations([...mockLocations(), location]);
    return location;
  }
  const res = (await adminClient().createStockLocation({
    name: input.name,
    priority: input.priority,
  })) as StockLocation;
  return mapLocation(res);
}

export async function updateStockLocation(id: string, input: StockLocationInput): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSaveLocations(
      mockLocations().map((l) =>
        l.id === id ? { ...l, name: input.name, priority: input.priority ?? l.priority } : l,
      ),
    );
    return;
  }
  await adminClient().updateStockLocation(id, { name: input.name, priority: input.priority });
}

// ------------------------------------------------------------------ *
// 对外接口（按仓库存行）
// ------------------------------------------------------------------ *

/**
 * 按仓库存行。
 *
 * `lowStockThreshold` 传了就只返回可用量 ≤ 该值的行（库存预警，ADR-039）。
 * 阈值由界面传，不在后端写死 —— 卖手机和卖家具的「低库存」不是一个数。
 */
export async function listInventoryLevels(
  locationId?: string,
  lowStockThreshold?: number,
): Promise<InventoryLevelView[]> {
  if (getAdminApiMode() !== 'live') {
    let list = mockLevels();
    if (locationId) list = list.filter((l) => l.locationId === locationId);
    if (lowStockThreshold !== undefined) {
      list = list.filter((l) => l.available <= lowStockThreshold);
    }
    return list;
  }
  const res = (await adminClient().listInventoryLevels({
    ...(locationId ? { location_id: locationId } : {}),
    ...(lowStockThreshold !== undefined ? { low_stock_threshold: lowStockThreshold } : {}),
    limit: 200,
  })) as { items?: InventoryLevelRow[] };
  return (res.items ?? []).map(mapLevel);
}

// ------------------------------------------------------------------ *
// 对外接口（调拨）
// ------------------------------------------------------------------ *

/** 后端调拨流水不带 sku，这里用「库存行」的 item → sku 映射补上（失败则回落 id）。 */
async function liveSkuMap(): Promise<Map<string, string>> {
  const res = (await adminClient().listInventoryLevels({ limit: 200 })) as { items?: InventoryLevelRow[] };
  const map = new Map<string, string>();
  for (const row of res.items ?? []) {
    if (!map.has(row.inventory_item_id)) map.set(row.inventory_item_id, row.sku);
  }
  return map;
}

export async function listTransfers(status?: TransferStatus): Promise<TransferView[]> {
  if (getAdminApiMode() !== 'live') {
    const list = mockTransfers();
    return status ? list.filter((t) => t.status === status) : list;
  }
  const client = adminClient();
  const res = (await client.listInventoryTransfers({
    limit: 100,
    ...(status ? { status } : {}),
  })) as { items?: InventoryTransfer[] };
  const items = res.items ?? [];
  // 接口已 join 出 sku；只有历史/单查数据缺 sku 时才回落到库存行建映射。
  const skuMap = items.some((t) => !t.sku)
    ? await liveSkuMap()
    : new Map<string, string>();
  return items.map((t) =>
    mapTransfer(t, t.sku ?? skuMap.get(t.inventory_item_id) ?? t.inventory_item_id),
  );
}

export async function createTransfer(input: TransferInput): Promise<TransferView> {
  if (getAdminApiMode() !== 'live') {
    const transfer: TransferView = {
      id: newMockId('xfer'),
      inventoryItemId: input.inventoryItemId,
      sku: mockSkuOf(input.inventoryItemId),
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      quantity: input.quantity,
      status: 'pending',
      note: input.note?.trim() ? input.note.trim() : null,
      createdAt: new Date().toISOString(),
    };
    mockSaveTransfers([transfer, ...mockTransfers()]);
    return transfer;
  }
  const res = (await adminClient().createInventoryTransfer({
    inventory_item_id: input.inventoryItemId,
    from_location_id: input.fromLocationId,
    to_location_id: input.toLocationId,
    quantity: input.quantity,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  })) as InventoryTransfer;
  return mapTransfer(res, (await liveSkuMap()).get(res.inventory_item_id) ?? res.inventory_item_id);
}

/** mock 里真的搬货：源仓 stocked/available 各减、目标仓加；reserved 不动（ADR-013 §4）。 */
function mockMoveStock(transfer: TransferView): void {
  const levels = mockLevels();
  const source = levels.find(
    (l) => l.inventoryItemId === transfer.inventoryItemId && l.locationId === transfer.fromLocationId,
  );
  if (!source) throw new Error('源仓没有该物料的库存行，无法完成调拨');
  if (source.stocked - source.reserved < transfer.quantity) {
    throw new Error('源仓可用量不足，不能把已承诺给订单的货调走');
  }

  const next = levels.map((l) => {
    if (l.id === source.id) return withAvailable({ ...l, stocked: l.stocked - transfer.quantity });
    if (l.inventoryItemId === transfer.inventoryItemId && l.locationId === transfer.toLocationId) {
      return withAvailable({ ...l, stocked: l.stocked + transfer.quantity });
    }
    return l;
  });

  const targetExists = next.some(
    (l) => l.inventoryItemId === transfer.inventoryItemId && l.locationId === transfer.toLocationId,
  );
  if (!targetExists) {
    next.push(
      withAvailable({
        id: newMockId('ilv'),
        inventoryItemId: transfer.inventoryItemId,
        sku: source.sku,
        locationId: transfer.toLocationId,
        stocked: transfer.quantity,
        reserved: 0,
        available: 0,
      }),
    );
  }
  mockSaveLevels(next);
}

function mockSetTransferStatus(id: string, status: TransferStatus): TransferView {
  const list = mockTransfers();
  const found = list.find((t) => t.id === id);
  if (!found) throw new Error('调拨单不存在');
  found.status = status;
  mockSaveTransfers(list);
  return found;
}

export async function completeTransfer(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const transfer = mockTransfers().find((t) => t.id === id);
    if (!transfer) throw new Error('调拨单不存在');
    if (transfer.status !== 'pending') throw new Error('只有待处理的调拨单可以完成');
    mockMoveStock(transfer);
    mockSetTransferStatus(id, 'completed');
    return;
  }
  await adminClient().completeInventoryTransfer(id);
}

export async function cancelTransfer(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSetTransferStatus(id, 'cancelled');
    return;
  }
  await adminClient().cancelInventoryTransfer(id);
}
