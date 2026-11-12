/**
 * 商品分类数据层（ADR-028）。
 *
 * 对应淘宝「商品 → 商品分类」：分类决定顾客怎么逛（分类导航 → 分类页 → 商品），
 * 是商品域的组织方式，不是标签、也不是营销分组。
 *
 * 只做两级（一级 + 二级）：淘宝的多级类目对自建店铺是过度设计，
 * 商家真正需要的是「能建、能排序、能改、看得见每类有多少货」。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export interface CategoryView {
  id: string;
  name: string;
  /** URL 标识；中文名生成不了可读 slug 时后端会退回短码。 */
  handle: string;
  parentId: string | null;
  sortOrder: number;
  /** 该类下直接关联的商品数（不含子分类）。 */
  productCount: number;
}

export interface CategoryInput {
  name: string;
  handle?: string;
  parentId?: string | null;
  sortOrder?: number;
}

/** 树形展示用的节点。 */
export interface CategoryNode extends CategoryView {
  children: CategoryView[];
}

const KEY = 'admin:categories';

const SEED: CategoryView[] = [
  { id: 'cat_seed_1', name: '服饰', handle: 'apparel', parentId: null, sortOrder: 0, productCount: 0 },
  { id: 'cat_seed_2', name: '外套', handle: 'coats', parentId: 'cat_seed_1', sortOrder: 0, productCount: 0 },
  { id: 'cat_seed_3', name: '数码', handle: 'digital', parentId: null, sortOrder: 1, productCount: 0 },
];

function readMock(): CategoryView[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CategoryView[];
  } catch {
    /* 隐私模式：用种子数据 */
  }
  return SEED.map((c) => ({ ...c }));
}

function writeMock(list: CategoryView[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* noop */
  }
}

function mapRow(raw: Record<string, unknown>): CategoryView {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    handle: String(raw.handle ?? ''),
    parentId: (raw.parent_id as string | null) ?? null,
    sortOrder: Number(raw.sort_order ?? 0),
    productCount: Number(raw.product_count ?? 0),
  };
}

export async function listCategories(): Promise<CategoryView[]> {
  if (getAdminApiMode() !== 'live') return readMock();
  const res = (await adminClient().listCategories()) as { items?: Array<Record<string, unknown>> };
  return (res.items ?? []).map(mapRow);
}

export async function createCategory(input: CategoryInput): Promise<CategoryView> {
  if (getAdminApiMode() !== 'live') {
    const list = readMock();
    const created: CategoryView = {
      id: `cat_${Date.now().toString(36)}`,
      name: input.name,
      handle: input.handle?.trim() || input.name,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 0,
      productCount: 0,
    };
    writeMock([...list, created]);
    return created;
  }
  const raw = (await adminClient().createCategory({
    name: input.name,
    ...(input.handle ? { handle: input.handle } : {}),
    ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
    ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
  })) as Record<string, unknown>;
  return mapRow(raw);
}

export async function updateCategory(id: string, patch: CategoryInput): Promise<CategoryView> {
  if (getAdminApiMode() !== 'live') {
    const list = readMock();
    const row = list.find((c) => c.id === id);
    if (!row) throw new Error('分类不存在');
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.handle !== undefined) row.handle = patch.handle;
    if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
    writeMock(list);
    return { ...row };
  }
  const raw = (await adminClient().updateCategory(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
  })) as Record<string, unknown>;
  return mapRow(raw);
}

export async function deleteCategory(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = readMock();
    const row = list.find((c) => c.id === id);
    if (row && row.productCount > 0) {
      throw new Error(`该分类下还有 ${row.productCount} 个商品，请先把商品移到别的分类`);
    }
    writeMock(list.filter((c) => c.id !== id));
    return;
  }
  await adminClient().deleteCategory(id);
}

/** 扁平列表 → 两级树（一级按 sortOrder，二级同样）。 */
export function buildTree(list: CategoryView[]): CategoryNode[] {
  const roots = list
    .filter((c) => !c.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return roots.map((root) => ({
    ...root,
    children: list
      .filter((c) => c.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  }));
}
