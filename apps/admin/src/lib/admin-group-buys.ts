import { adminClient, getAdminApiMode } from './admin-client';
import {
  createGroupBuy as mockCreateGroupBuy,
  listGroupBuys as mockListGroupBuys,
  setGroupBuyStatus as mockSetGroupBuyStatus,
} from './admin-store';

/**
 * 拼团数据层（ADR-100）。
 *
 * 拼团是「参团免费、成团领券」：活动创建时会自动建一张拼团专享券，
 * 成团后成员领券、拿券正常下单 —— 不新增订单与支付链路。
 */
export type GroupBuyStatus = 'draft' | 'active' | 'ended';

export interface GroupBuyView {
  id: string;
  name: string;
  variantId: string;
  productId: string;
  title: string;
  originalPriceMinor: number;
  groupPriceMinor: number;
  teamSize: number;
  status: GroupBuyStatus;
  startsAt: string;
  endsAt: string;
  voucherId: string;
}

export interface CreateGroupBuyInput {
  name: string;
  variantId: string;
  productId: string;
  title: string;
  originalPriceMinor: number;
  groupPriceMinor: number;
  teamSize: number;
  startsAt: string;
  endsAt: string;
}

function mapActivity(a: Record<string, unknown>): GroupBuyView {
  return {
    id: String(a.id ?? ''),
    name: String(a.name ?? ''),
    variantId: String(a.variant_id ?? ''),
    productId: String(a.product_id ?? ''),
    title: String(a.title ?? ''),
    originalPriceMinor: Number(a.original_price_minor ?? 0),
    groupPriceMinor: Number(a.group_price_minor ?? 0),
    teamSize: Number(a.team_size ?? 2),
    status: (a.status as GroupBuyStatus) ?? 'draft',
    startsAt: String(a.starts_at ?? ''),
    endsAt: String(a.ends_at ?? ''),
    voucherId: String(a.voucher_id ?? ''),
  };
}

export async function listGroupBuys(q: {
  status?: GroupBuyStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<GroupBuyView[]> {
  if (getAdminApiMode() !== 'live') {
    return mockListGroupBuys(q.status);
  }
  const res = (await adminClient().listGroupBuys({
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
    ...(q.status ? { status: q.status } : {}),
  })) as { items?: Array<Record<string, unknown>> };
  return (res.items ?? []).map(mapActivity);
}

export async function createGroupBuy(input: CreateGroupBuyInput): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockCreateGroupBuy(input);
    return;
  }
  await adminClient().createGroupBuy({
    name: input.name,
    variant_id: input.variantId,
    title: input.title,
    original_price_minor: input.originalPriceMinor,
    group_price_minor: input.groupPriceMinor,
    team_size: input.teamSize,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
  });
}

export async function setGroupBuyStatus(id: string, status: 'active' | 'ended'): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSetGroupBuyStatus(id, status);
    return;
  }
  await adminClient().setGroupBuyStatus(id, status);
}
