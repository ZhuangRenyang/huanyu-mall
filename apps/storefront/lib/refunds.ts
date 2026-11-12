/**
 * 顾客端退款申请（淘宝「申请售后」）。
 *
 * 只提交原因，**金额由服务端按订单实付取**——顾客不能填金额，也不能只退一部分。
 * 提交后是「待商家处理」，不是立即到账：商家在后台同意后才原路退回。
 */
import { getStoreClient } from './api';
import { getApiMode } from './api';

export type StoreRefundStatus = 'pending' | 'approved' | 'rejected' | 'canceled';

export interface StoreRefundView {
  id: string;
  status: StoreRefundStatus;
  amountMinor: number;
  reason: string;
  /** 商家处理说明（拒绝时会有）。 */
  reviewNote: string | null;
  createdAt: string;
}

interface RawRefund {
  id: string;
  status?: string;
  amount_minor?: number;
  reason?: string;
  review_note?: string | null;
  created_at?: string;
}

function mapRefund(r: RawRefund): StoreRefundView {
  return {
    id: r.id,
    status: (r.status as StoreRefundStatus) ?? 'pending',
    amountMinor: Number(r.amount_minor ?? 0),
    reason: r.reason ?? '',
    reviewNote: r.review_note ?? null,
    createdAt: r.created_at ?? '',
  };
}

/** 该订单的退款申请记录（最多一条有效记录，历史记录也一并返回）。 */
export async function loadOrderRefunds(orderId: string): Promise<StoreRefundView[]> {
  if (getApiMode() !== 'live') return [];
  try {
    const res = (await getStoreClient().listOrderRefunds(orderId)) as { items?: RawRefund[] };
    return (res.items ?? []).map(mapRefund);
  } catch {
    // 查不到不该挡住订单页；退一步按「没有申请」显示
    return [];
  }
}

export async function requestOrderRefund(orderId: string, reason: string): Promise<void> {
  if (getApiMode() !== 'live') {
    throw new Error('演示模式无法提交退款申请，请在正式环境操作');
  }
  await getStoreClient().requestOrderRefund(orderId, { reason });
}
