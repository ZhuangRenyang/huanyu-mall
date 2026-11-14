import { adminClient, getAdminApiMode } from './admin-client';
import {
  createFlashSale as mockCreateFlashSale,
  listFlashSales as mockListFlashSales,
  setFlashSaleStatus as mockSetFlashSaleStatus,
} from './admin-store';

/**
 * 秒杀管理数据层（ADR-099）。
 *
 * 与其它营销页同一套路：mock 走 localStorage、live 走 SDK。
 * 金额一律 minor unit，前端只格式化（铁律 13）。
 */
export type FlashSaleStatus = 'draft' | 'active' | 'ended';

export interface FlashSaleItemView {
  id: string;
  variantId: string;
  title: string;
  originalPriceMinor: number;
  flashPriceMinor: number;
  stock: number;
  sold: number;
  remaining: number;
}

export interface FlashSaleView {
  id: string;
  name: string;
  status: FlashSaleStatus;
  startsAt: string;
  endsAt: string;
  items: FlashSaleItemView[];
}

export interface CreateFlashSaleItemInput {
  variantId: string;
  title: string;
  originalPriceMinor: number;
  flashPriceMinor: number;
  stock: number;
}

export interface CreateFlashSaleInput {
  name: string;
  startsAt: string;
  endsAt: string;
  items: CreateFlashSaleItemInput[];
}

function mapSale(s: Record<string, unknown>): FlashSaleView {
  const rawItems = (s.items as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    status: (s.status as FlashSaleStatus) ?? 'draft',
    startsAt: String(s.starts_at ?? ''),
    endsAt: String(s.ends_at ?? ''),
    items: rawItems.map((i) => {
      const stock = Number(i.stock ?? 0);
      const sold = Number(i.sold ?? 0);
      return {
        id: String(i.id ?? ''),
        variantId: String(i.variant_id ?? ''),
        title: String(i.title ?? ''),
        originalPriceMinor: Number(i.original_price_minor ?? 0),
        flashPriceMinor: Number(i.flash_price_minor ?? 0),
        stock,
        sold,
        remaining: Number(i.remaining ?? Math.max(stock - sold, 0)),
      };
    }),
  };
}

export async function listFlashSales(q: {
  status?: FlashSaleStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<FlashSaleView[]> {
  if (getAdminApiMode() !== 'live') {
    return mockListFlashSales(q.status).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      items: s.items.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        title: i.title,
        originalPriceMinor: i.originalPriceMinor,
        flashPriceMinor: i.flashPriceMinor,
        stock: i.stock,
        sold: i.sold,
        remaining: Math.max(i.stock - i.sold, 0),
      })),
    }));
  }
  const res = (await adminClient().listFlashSales({
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
    ...(q.status ? { status: q.status } : {}),
  })) as { items?: Array<Record<string, unknown>> };
  return (res.items ?? []).map(mapSale);
}

export async function createFlashSale(input: CreateFlashSaleInput): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockCreateFlashSale(input);
    return;
  }
  await adminClient().createFlashSale({
    name: input.name,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    items: input.items.map((i) => ({
      variant_id: i.variantId,
      title: i.title,
      original_price_minor: i.originalPriceMinor,
      // 目标价必须低于原价：这里是最后一道本地校验，服务端还会再挡一次
      flash_price_minor: i.flashPriceMinor,
      stock: i.stock,
    })),
  });
}

/** 上架 / 结束。 */
export async function setFlashSaleStatus(id: string, status: 'active' | 'ended'): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSetFlashSaleStatus(id, status);
    return;
  }
  await adminClient().setFlashSaleStatus(id, status);
}
