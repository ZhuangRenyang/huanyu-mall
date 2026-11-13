import { formatMoney } from '@mall/ui';
import { getApiMode, getStoreClient } from './api';

/**
 * 店铺券（ADR-029）。
 *
 * 两条路径共用同一个「券」：可领取的店铺券（淘宝式，点一下进卡券包）
 * 和后台生成的一串券码（Shopify 式，输码使用）。
 * live 模式下领取会换回一条专属券码，结账时把它交给购物车即可 —— 与输码完全同一条链路。
 */

export interface PublicVoucherView {
  id: string;
  name: string;
  /** 整单 / 运费 / 指定商品（ADR-064：specific_product 只对命中范围的行生效）。 */
  type: 'entire_order' | 'shipping' | 'specific_product';
  /** 适用范围文案（ADR-066）：如「限 2 件商品、1 个分类」；无范围时为空。 */
  scopeLabel?: string;
  /** fixed = 减固定金额（minor）；percentage = 减百分比（bps）。 */
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  minSpentMinor: number | null;
  startsAt: string | null;
  endsAt: string | null;
  collected: boolean;
  collectLimit: number;
  collectedCount: number;
}

export interface MyVoucherView {
  id: string;
  /** 结账时套用的凭证。 */
  code: string;
  name: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  minSpentMinor: number | null;
  endsAt: string | null;
  status: 'unused' | 'used';
  /** 适用范围文案（ADR-066）；无范围时为空。 */
  scopeLabel?: string;
  /** 过期按 ends_at 现算（后端不落「已过期」状态）。 */
  expired: boolean;
}

interface ApiVoucher {
  id: string;
  name: string;
  type?: 'entire_order' | 'shipping' | 'specific_product';
  scopes?: Array<{ scope_type: 'product' | 'category'; scope_id: string }>;
  discount_type: 'fixed' | 'percentage';
  discount_value: number | string;
  min_spent: number | string | null;
  starts_at: string | null;
  ends_at: string | null;
  collected?: boolean;
  collect_limit?: number;
  collected_count?: number;
}

interface ApiMyVoucher {
  id: string;
  code: string;
  name: string;
  scopes?: Array<{ scope_type: 'product' | 'category'; scope_id: string }>;
  discount_type: 'fixed' | 'percentage';
  discount_value: number | string;
  min_spent: number | string | null;
  ends_at: string | null;
  status: 'unused' | 'used';
}

/** 范围 → 一行文案（ADR-066）：只数数量，不展开商品名（展开要跨模块取名称）。 */
function scopeLabelFrom(scopes?: Array<{ scope_type: string; scope_id: string }>): string | undefined {
  if (!scopes || scopes.length === 0) return undefined;
  const products = scopes.filter((sc) => sc.scope_type === 'product').length;
  const categories = scopes.filter((sc) => sc.scope_type === 'category').length;
  const parts: string[] = [];
  if (products > 0) parts.push(`限 ${products} 件商品`);
  if (categories > 0) parts.push(`限 ${categories} 个分类`);
  return parts.join('、');
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v);
}

const MOCK_KEY = 'vouchers:collected';

/** 演示模式的券：数据写死，领取状态存本地，行为与后端一致（重复领取幂等）。 */
const MOCK_PUBLIC: PublicVoucherView[] = [
  {
    id: 'vch_demo_1',
    name: '满 199 减 20',
    type: 'entire_order',
    discountType: 'fixed',
    discountValue: 2000,
    minSpentMinor: 19900,
    startsAt: null,
    endsAt: null,
    collected: false,
    collectLimit: 1,
    collectedCount: 0,
  },
  {
    id: 'vch_demo_2',
    name: '全店 9 折（减 10%）',
    type: 'entire_order',
    discountType: 'percentage',
    discountValue: 1000,
    minSpentMinor: null,
    startsAt: null,
    endsAt: null,
    collected: false,
    collectLimit: 1,
    collectedCount: 0,
  },
];

interface MockCollectedEntry {
  code: string;
  name: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  minSpentMinor: number | null;
  endsAt: string | null;
}

function mockCollected(): Record<string, MockCollectedEntry> {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, MockCollectedEntry>) : {};
  } catch {
    return {};
  }
}

function writeMockCollected(next: Record<string, unknown>): void {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

/**
 * 店面可领的券（商品页券条用；服务端渲染时也可以调）。
 *
 * 传 `handle` 就只取这个商品能用的券（ADR-071）：淘宝商品页的领券区不会
 * 摆一张「限别的商品」的券 —— 顾客领了也用不了，等于骗他点一下。
 */
export async function getStoreVouchers(handle?: string): Promise<{
  items: PublicVoucherView[];
  currencyCode: string;
}> {
  if (getApiMode() !== 'live') {
    const mine = mockCollected();
    return {
      items: MOCK_PUBLIC.map((v) => ({
        ...v,
        collected: Boolean(mine[v.id]),
        collectedCount: mine[v.id] ? 1 : 0,
      })),
      currencyCode: 'CNY',
    };
  }
  try {
    const client = getStoreClient();
    const res = (await (handle
      ? client.listProductVouchers(handle)
      : client.listPublicVouchers())) as {
      items?: ApiVoucher[];
      currency_code?: string;
    };
    return {
      currencyCode: res.currency_code ?? 'CNY',
      items: (res.items ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type ?? 'entire_order',
      scopeLabel: scopeLabelFrom(v.scopes),
      discountType: v.discount_type,
      discountValue: toNum(v.discount_value),
      minSpentMinor: v.min_spent === null ? null : toNum(v.min_spent),
      startsAt: v.starts_at,
      endsAt: v.ends_at,
      collected: v.collected === true,
      collectLimit: v.collect_limit ?? 1,
        collectedCount: v.collected_count ?? 0,
      })),
    };
  } catch {
    return { items: [], currencyCode: 'CNY' };
  }
}

/** 领取一张券。返回券码；重复领取后端幂等返回原码。 */
export async function claimVoucher(id: string): Promise<{ code: string; alreadyCollected: boolean }> {
  if (getApiMode() !== 'live') {
    const v = MOCK_PUBLIC.find((x) => x.id === id);
    if (!v) throw new Error('券不存在');
    const mine = mockCollected();
    if (mine[id]) return { code: mine[id]!.code, alreadyCollected: true };
    const code = `MOCK${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    writeMockCollected({ ...mine, [id]: { code, name: v.name, discountType: v.discountType, discountValue: v.discountValue, minSpentMinor: v.minSpentMinor, endsAt: null } });
    return { code, alreadyCollected: false };
  }
  const res = (await getStoreClient().collectVoucher(id)) as {
    code?: string;
    already_collected?: boolean;
  };
  if (!res.code) throw new Error('领取失败：服务端未返回券码');
  return { code: res.code, alreadyCollected: res.already_collected === true };
}

/** 我的卡券（需登录）。 */
export async function fetchMyVouchers(): Promise<{
  items: MyVoucherView[];
  currencyCode: string;
}> {
  const now = Date.now();
  if (getApiMode() !== 'live') {
    return {
      currencyCode: 'CNY',
      items: Object.values(mockCollected()).map((v, i) => ({
        id: `vcol_mock_${i}`,
        code: v.code,
        name: v.name,
        discountType: v.discountType,
        discountValue: v.discountValue,
        minSpentMinor: v.minSpentMinor,
        endsAt: v.endsAt,
        status: 'unused' as const,
        expired: v.endsAt ? new Date(v.endsAt).getTime() < now : false,
      })),
    };
  }
  const res = (await getStoreClient().listMyVouchers()) as {
    items?: ApiMyVoucher[];
    currency_code?: string;
  };
  return {
    currencyCode: res.currency_code ?? 'CNY',
    items: (res.items ?? []).map((v) => ({
    id: v.id,
    code: v.code,
    name: v.name,
    scopeLabel: scopeLabelFrom(v.scopes),
    discountType: v.discount_type,
    discountValue: toNum(v.discount_value),
    minSpentMinor: v.min_spent === null ? null : toNum(v.min_spent),
    endsAt: v.ends_at,
      status: v.status,
      expired: v.ends_at ? new Date(v.ends_at).getTime() < now : false,
    })),
  };
}

/** 券面额文案：「减 ￥20」/「减 10%」。 */
export function voucherValueText(
  v: { discountType: 'fixed' | 'percentage'; discountValue: number },
  currencyCode: string,
): string {
  if (v.discountType === 'percentage') {
    // 百分比是「减去多少」：1000 bps = 减 10%。写「打 10 折」会误导（中文 9 折才是付 90%）
    return `减 ${(v.discountValue / 100).toFixed(0)}%`;
  }
  return `减 ${formatMoney(v.discountValue, currencyCode)}`;
}

/** 门槛文案：「满 ￥199 可用」/「无门槛」。 */
export function voucherThresholdText(
  minSpentMinor: number | null,
  currencyCode: string,
): string {
  return minSpentMinor && minSpentMinor > 0
    ? `满 ${formatMoney(minSpentMinor, currencyCode)} 可用`
    : '无门槛';
}
