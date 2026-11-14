/**
 * 店面秒杀（ADR-099）。
 *
 * 只读：拿进行中、还有剩余的活动。价格是活动价，实际结算仍由服务端
 * 按购物车真实单价重算（前端展示价不参与任何计价）。
 */
import { getApiMode, getStoreClient } from './api';

export interface StoreFlashSaleItem {
  id: string;
  variantId: string;
  title: string;
  originalPriceMinor: number;
  flashPriceMinor: number;
  stock: number;
  sold: number;
  remaining: number;
}

export interface StoreFlashSale {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  items: StoreFlashSaleItem[];
}

interface RawSale {
  id?: string;
  name?: string;
  starts_at?: string;
  ends_at?: string;
  items?: Array<{
    id?: string;
    variant_id?: string;
    title?: string;
    original_price_minor?: number | string;
    flash_price_minor?: number | string;
    stock?: number;
    sold?: number;
    remaining?: number;
  }>;
}

export async function loadActiveFlashSales(): Promise<StoreFlashSale[]> {
  if (getApiMode() !== 'live') return [];
  try {
    const res = (await getStoreClient().listFlashSales()) as { items?: RawSale[] };
    return (res.items ?? []).map((s) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      startsAt: String(s.starts_at ?? ''),
      endsAt: String(s.ends_at ?? ''),
      items: (s.items ?? []).map((i) => {
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
    }));
  } catch {
    // 秒杀是营销位，挂了不该挡住首页/其它页面
    return [];
  }
}
