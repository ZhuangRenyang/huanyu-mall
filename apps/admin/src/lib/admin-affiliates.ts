import { adminClient, getAdminApiMode } from './admin-client';
import {
  listAffiliates as mockListAffiliates,
  listCommissions as mockListCommissions,
  registerAffiliate as mockRegisterAffiliate,
  setAffiliateStatus as mockSetAffiliateStatus,
  settleCommission as mockSettleCommission,
} from './admin-store';

/**
 * 分销数据层（ADR-101）。
 *
 * 佣金只是账本：`settle` 只把流水标成已结算，系统不发起任何转账
 * （商家线下打款后回后台点一下）。
 */
export type AffiliateStatus = 'active' | 'disabled';
export type CommissionStatus = 'pending' | 'settled' | 'canceled';

export interface AffiliateView {
  id: string;
  customerId: string;
  code: string;
  commissionBps: number;
  status: AffiliateStatus;
  createdAt: string;
}

export interface CommissionView {
  id: string;
  affiliateId: string;
  orderId: string;
  orderTotalMinor: number;
  commissionMinor: number;
  status: CommissionStatus;
  settledAt: string | null;
  canceledReason: string | null;
  createdAt: string;
}

function mapAffiliate(a: Record<string, unknown>): AffiliateView {
  return {
    id: String(a.id ?? ''),
    customerId: String(a.customer_id ?? ''),
    code: String(a.code ?? ''),
    commissionBps: Number(a.commission_bps ?? 0),
    status: (a.status as AffiliateStatus) ?? 'active',
    createdAt: String(a.created_at ?? ''),
  };
}

function mapCommission(c: Record<string, unknown>): CommissionView {
  return {
    id: String(c.id ?? ''),
    affiliateId: String(c.affiliate_id ?? ''),
    orderId: String(c.order_id ?? ''),
    orderTotalMinor: Number(c.order_total_minor ?? 0),
    commissionMinor: Number(c.commission_minor ?? 0),
    status: (c.status as CommissionStatus) ?? 'pending',
    settledAt: (c.settled_at as string | null) ?? null,
    canceledReason: (c.canceled_reason as string | null) ?? null,
    createdAt: String(c.created_at ?? ''),
  };
}

export async function listAffiliates(q: { limit?: number; offset?: number } = {}): Promise<AffiliateView[]> {
  if (getAdminApiMode() !== 'live') {
    return mockListAffiliates().map((a) => ({
      id: a.id,
      customerId: a.customerId,
      code: a.code,
      commissionBps: a.commissionBps,
      status: a.status,
      createdAt: a.createdAt,
    }));
  }
  const res = (await adminClient().listAffiliates({ limit: q.limit ?? 50, offset: q.offset ?? 0 })) as {
    items?: Array<Record<string, unknown>>;
  };
  return (res.items ?? []).map(mapAffiliate);
}

export async function registerAffiliate(input: {
  customerId: string;
  code?: string;
  commissionBps: number;
}): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockRegisterAffiliate(input);
    return;
  }
  await adminClient().registerAffiliate({
    customer_id: input.customerId,
    ...(input.code?.trim() ? { code: input.code.trim() } : {}),
    commission_bps: input.commissionBps,
  });
}

export async function setAffiliateStatus(id: string, status: AffiliateStatus): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSetAffiliateStatus(id, status);
    return;
  }
  await adminClient().setAffiliateStatus(id, status);
}

export async function listCommissions(q: { status?: CommissionStatus } = {}): Promise<CommissionView[]> {
  if (getAdminApiMode() !== 'live') {
    return mockListCommissions(q.status).map((c) => ({
      id: c.id,
      affiliateId: c.affiliateId,
      orderId: c.orderId,
      orderTotalMinor: c.orderTotalMinor,
      commissionMinor: c.commissionMinor,
      status: c.status,
      settledAt: c.settledAt,
      canceledReason: c.canceledReason,
      createdAt: c.createdAt,
    }));
  }
  const res = (await adminClient().listCommissions({
    limit: 50,
    offset: 0,
    ...(q.status ? { status: q.status } : {}),
  })) as { items?: Array<Record<string, unknown>> };
  return (res.items ?? []).map(mapCommission);
}

/** 标记已结算：系统不转账，商家线下打款后点这里。 */
export async function settleCommission(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSettleCommission(id);
    return;
  }
  await adminClient().settleCommission(id);
}
