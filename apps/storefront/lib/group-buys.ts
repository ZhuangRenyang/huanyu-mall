/**
 * 店面拼团（ADR-100）。
 *
 * 参团免费、成团领券：参团不收款、不建订单；成团后领一张拼团专享券，
 * 拿券走正常下单 —— 所以未成团不需要退款。
 */
import { getApiMode, getStoreClient } from './api';

export interface StoreGroupBuy {
  id: string;
  name: string;
  variantId: string;
  title: string;
  originalPriceMinor: number;
  groupPriceMinor: number;
  teamSize: number;
  startsAt: string;
  endsAt: string;
}

export type GroupBuyTeamStatus = 'forming' | 'success' | 'expired';

export interface StoreGroupBuyTeam {
  id: string;
  groupBuyId: string;
  status: GroupBuyTeamStatus;
  memberCount: number;
  teamSize: number;
  expiresAt: string;
}

export interface MyGroupBuy {
  groupBuy: StoreGroupBuy;
  team: StoreGroupBuyTeam;
}

interface RawActivity {
  id?: string;
  name?: string;
  variant_id?: string;
  title?: string;
  original_price_minor?: number | string;
  group_price_minor?: number | string;
  team_size?: number;
  starts_at?: string;
  ends_at?: string;
}

interface RawTeam {
  id?: string;
  group_buy_id?: string;
  status?: string;
  member_count?: number;
  team_size?: number;
  expires_at?: string;
}

function mapActivity(a: RawActivity): StoreGroupBuy {
  return {
    id: String(a.id ?? ''),
    name: String(a.name ?? ''),
    variantId: String(a.variant_id ?? ''),
    title: String(a.title ?? ''),
    originalPriceMinor: Number(a.original_price_minor ?? 0),
    groupPriceMinor: Number(a.group_price_minor ?? 0),
    teamSize: Number(a.team_size ?? 2),
    startsAt: String(a.starts_at ?? ''),
    endsAt: String(a.ends_at ?? ''),
  };
}

function mapTeam(t: RawTeam): StoreGroupBuyTeam {
  return {
    id: String(t.id ?? ''),
    groupBuyId: String(t.group_buy_id ?? ''),
    status: (t.status as GroupBuyTeamStatus) ?? 'forming',
    memberCount: Number(t.member_count ?? 0),
    teamSize: Number(t.team_size ?? 2),
    expiresAt: String(t.expires_at ?? ''),
  };
}

export async function loadActiveGroupBuys(): Promise<StoreGroupBuy[]> {
  if (getApiMode() !== 'live') return [];
  try {
    const res = (await getStoreClient().listGroupBuys()) as { items?: RawActivity[] };
    return (res.items ?? []).map(mapActivity);
  } catch {
    return [];
  }
}

/** 我的拼团；未登录返回空（不是错误）。 */
export async function loadMyGroupBuys(): Promise<MyGroupBuy[]> {
  if (getApiMode() !== 'live') return [];
  try {
    const res = (await getStoreClient().listMyGroupBuys()) as {
      items?: Array<{ group_buy?: RawActivity; team?: RawTeam }>;
    };
    return (res.items ?? [])
      .filter((i) => i.group_buy && i.team)
      .map((i) => ({ groupBuy: mapActivity(i.group_buy!), team: mapTeam(i.team!) }));
  } catch {
    return [];
  }
}

/** 参团：登录必需（团要挂到人头上，成团后才知道给谁发券）。 */
export async function joinGroupBuy(id: string): Promise<StoreGroupBuyTeam> {
  if (getApiMode() !== 'live') {
    throw new Error('演示模式无法参团，请在正式环境操作');
  }
  const res = (await getStoreClient().joinGroupBuy(id)) as { team?: RawTeam };
  if (!res.team) throw new Error('参团失败');
  return mapTeam(res.team);
}

/** 成团后领拼团券（幂等：重复领返回同一张码）。 */
export async function claimGroupBuyVoucher(id: string): Promise<string> {
  if (getApiMode() !== 'live') {
    throw new Error('演示模式无法领券，请在正式环境操作');
  }
  const res = (await getStoreClient().claimGroupBuyVoucher(id)) as { code?: string };
  if (!res.code) throw new Error('领券失败');
  return res.code;
}
