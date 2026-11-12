/**
 * 退款管理数据层（对齐淘宝「交易 → 退款管理」）。
 *
 * 单据与资金分开：这里读的是 `refund_request`（业务单据），
 * 真正打款记录在 payment.refund，页面不直接碰。
 *
 * mock 模式没有真实退款单：返回空列表并在页面说明「接后端后显示」，
 * **不编造假数据** —— 假退款单会让商家以为真有人申请。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export type RefundStatus = 'pending' | 'approved' | 'rejected' | 'canceled';
export type RefundSource = 'customer' | 'merchant';

export interface RefundRequestView {
  id: string;
  orderId: string;
  /** 下单邮箱，列表里当顾客标识。 */
  customerEmail: string | null;
  amountMinor: number;
  currencyCode: string;
  reason: string;
  source: RefundSource;
  status: RefundStatus;
  reviewNote: string | null;
  createdAt: string;
  /** 资金流水 id；未执行退款时为空。 */
  refundId: string | null;
}

export interface RefundListResult {
  items: RefundRequestView[];
  total: number;
}

const EMPTY: RefundListResult = { items: [], total: 0 };

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
    reviewNote: (r.review_note as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    refundId: (r.refund_id as string | null) ?? null,
  };
}

export async function listRefundRequests(q: {
  status?: RefundStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<RefundListResult> {
  if (getAdminApiMode() !== 'live') return EMPTY;
  const res = (await adminClient().listRefundRequests({
    limit: q.limit ?? 20,
    offset: q.offset ?? 0,
    ...(q.status ? { status: q.status } : {}),
  })) as { items?: Array<Record<string, unknown>>; count?: number };
  return {
    items: (res.items ?? []).map(mapRefund),
    total: res.count ?? 0,
  };
}

/** 同意退款：会真正打款，调用前必须让商家确认过。 */
export async function approveRefundRequest(id: string, note?: string): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  await adminClient().approveRefundRequest(id, note ? { note } : {});
}

/** 拒绝退款：理由必填（顾客要看到为什么被拒）。 */
export async function rejectRefundRequest(id: string, note: string): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  await adminClient().rejectRefundRequest(id, { note });
}
