/**
 * 退款管理数据层（对齐淘宝「交易 → 退款管理」）。
 *
 * 单据与资金分开：这里读的是 `refund_request`（业务单据），
 * 真正打款记录在 payment.refund，页面不直接碰。
 *
 * mock 模式下，本页操作产生的单据存在 localStorage（不预置假单据）：
 * 点「发起退款」→ 出现在待处理 → 同意/拒绝都生效，能完整走一遍流程。
 */
import { adminClient, getAdminApiMode } from './admin-client';
import {
  approveRefund as mockApproveRefund,
  listRefunds as mockListRefunds,
  receiveReturn as mockReceiveReturn,
  rejectRefund as mockRejectRefund,
} from './admin-store';
import type { AdminRefundRequest } from './admin-data';

export type RefundStatus =
  | 'pending'
  /** 商家已同意退货，等买家寄回（ADR-051）。 */
  | 'awaiting_return'
  /** 买家已寄回，等商家确认收货（此时才允许打款）。 */
  | 'returned'
  | 'approved'
  | 'rejected'
  | 'canceled';
export type RefundSource = 'customer' | 'merchant';

export type RefundRequestView = AdminRefundRequest;

export interface RefundCounts {
  pending: number;
  awaiting_return: number;
  returned: number;
  approved: number;
  rejected: number;
  canceled: number;
  all: number;
}

export interface RefundListResult {
  items: RefundRequestView[];
  total: number;
  /** 各状态数量（页签角标）；后端未返回时按当前页兜底。 */
  counts: RefundCounts;
}

const EMPTY: RefundListResult = {
  items: [],
  total: 0,
  counts: {
    pending: 0,
    awaiting_return: 0,
    returned: 0,
    approved: 0,
    rejected: 0,
    canceled: 0,
    all: 0,
  },
};

function mapRefund(r: Record<string, unknown>): RefundRequestView {
  return {
    id: String(r.id ?? ''),
    orderId: String(r.order_id ?? ''),
    customerEmail: (r.order_email as string | null) ?? null,
    amountMinor: Number(r.amount_minor ?? 0),
    currencyCode: String(r.currency_code ?? 'CNY'),
    reason: String(r.reason ?? ''),
    source: r.source === 'merchant' ? 'merchant' : 'customer',
    status: (r.status as RefundStatus) ?? 'pending',
    resolution: r.resolution === 'return_refund' ? 'return_refund' : 'refund_only',
    returnCarrier: (r.return_carrier as string | null) ?? null,
    returnTrackingNumber: (r.return_tracking_number as string | null) ?? null,
    reviewNote: (r.review_note as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    refundId: (r.refund_id as string | null) ?? null,
    orderStatusBefore: (r.order_status_before as string | null) ?? null,
  };
}

export async function listRefundRequests(q: {
  status?: RefundStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<RefundListResult> {
  if (getAdminApiMode() !== 'live') {
    const all = mockListRefunds(q.status);
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;
    const count = (s: RefundStatus) => mockListRefunds(s).length;
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      counts: {
        pending: count('pending'),
        awaiting_return: count('awaiting_return'),
        returned: count('returned'),
        approved: count('approved'),
        rejected: count('rejected'),
        canceled: count('canceled'),
        all: mockListRefunds().length,
      },
    };
  }
  const res = (await adminClient().listRefundRequests({
    limit: q.limit ?? 20,
    offset: q.offset ?? 0,
    ...(q.status ? { status: q.status } : {}),
  })) as {
    items?: Array<Record<string, unknown>>;
    count?: number;
    counts?: Partial<RefundCounts>;
  };
  return {
    items: (res.items ?? []).map(mapRefund),
    total: res.count ?? 0,
    counts: { ...EMPTY.counts, ...(res.counts ?? {}) },
  };
}

/** 同意退款：会真正打款，调用前必须让商家确认过。 */
export async function approveRefundRequest(id: string, note?: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockApproveRefund(id);
    return;
  }
  await adminClient().approveRefundRequest(id, note ? { note } : {});
}

/**
 * 确认收到退货并退款（退货退款的打款关卡）。
 *
 * 与「同意退款」一样会真正打款，调用前必须让商家确认过「货确实收到了」。
 */
export async function receiveReturn(id: string, note?: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockReceiveReturn(id, note);
    return;
  }
  await adminClient().receiveReturn(id, note ? { note } : {});
}

/** 拒绝退款：理由必填（顾客要看到为什么被拒）。 */
export async function rejectRefundRequest(id: string, note: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockRejectRefund(id, note);
    return;
  }
  await adminClient().rejectRefundRequest(id, { note });
}
