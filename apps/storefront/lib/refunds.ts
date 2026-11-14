/**
 * 顾客端退款申请（淘宝「申请售后」）。
 *
 * 只提交原因，**金额由服务端按订单实付取**——顾客不能填金额，也不能只退一部分。
 * 提交后是「待商家处理」，不是立即到账：商家在后台同意后才原路退回。
 */
import { getStoreClient } from './api';
import { getApiMode } from './api';

export type StoreRefundStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'canceled'
  /** 商家已同意退货，等买家寄回（ADR-051）。 */
  | 'awaiting_return'
  /** 买家已寄回，等商家确认收货。 */
  | 'returned'
  /** 换货：商家已收到退回，待发出换货（ADR-090）。 */
  | 'exchange_sending'
  /** 换货：换出商品已发出，售后完结（ADR-090）。 */
  | 'completed';

/** 售后类型：仅退款 / 退货退款（淘宝同一组选项）。 */
export type StoreRefundResolution = 'refund_only' | 'return_refund' | 'exchange';

export interface StoreRefundView {
  id: string;
  status: StoreRefundStatus;
  resolution: StoreRefundResolution;
  amountMinor: number;
  reason: string;
  /** 商家处理说明（拒绝时会有）。 */
  reviewNote: string | null;
  /** 买家填的退货物流（return_refund 且已寄回时才有）。 */
  /** 同意退货时快照的地址（ADR-061）；null = 当时店铺没配。 */
  returnAddress: string | null;
  returnCarrier: string | null;
  returnTrackingNumber: string | null;
  /** 换货（ADR-090）：目标快照与换出物流。 */
  exchangeLabel: string | null;
  exchangeCarrier: string | null;
  exchangeTrackingNumber: string | null;
  createdAt: string;
}

interface RawRefund {
  id: string;
  status?: string;
  resolution?: string;
  amount_minor?: number;
  reason?: string;
  review_note?: string | null;
  return_address?: string | null;
  return_carrier?: string | null;
  return_tracking_number?: string | null;
  exchange_label?: string | null;
  exchange_carrier?: string | null;
  exchange_tracking_number?: string | null;
  created_at?: string;
}

function mapRefund(r: RawRefund): StoreRefundView {
  return {
    id: r.id,
    status: (r.status as StoreRefundStatus) ?? 'pending',
    resolution:
      r.resolution === 'return_refund'
        ? 'return_refund'
        : r.resolution === 'exchange'
          ? 'exchange'
          : 'refund_only',
    amountMinor: Number(r.amount_minor ?? 0),
    reason: r.reason ?? '',
    reviewNote: r.review_note ?? null,
    returnAddress: r.return_address ?? null,
    exchangeLabel: r.exchange_label ?? null,
    exchangeCarrier: r.exchange_carrier ?? null,
    exchangeTrackingNumber: r.exchange_tracking_number ?? null,
    returnCarrier: r.return_carrier ?? null,
    returnTrackingNumber: r.return_tracking_number ?? null,
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

export async function requestOrderRefund(
  orderId: string,
  reason: string,
  resolution: StoreRefundResolution = 'refund_only',
  exchangeVariantId?: string,
): Promise<void> {
  if (getApiMode() !== 'live') {
    throw new Error('演示模式无法提交退款申请，请在正式环境操作');
  }
  await getStoreClient().requestOrderRefund(orderId, {
    reason,
    resolution,
    ...(resolution === 'exchange' && exchangeVariantId
      ? { exchange_variant_id: exchangeVariantId, exchange_quantity: 1 }
      : {}),
  });
}

/**
 * 提交退货物流（商家同意退货后）。
 *
 * 单号必填：没有单号商家收到空包裹也无从对账；
 * 服务端同样会拦（orders 模块 shipReturn），这里只是先省一次往返。
 */
export async function submitReturnShipment(
  refundId: string,
  carrier: string,
  trackingNumber: string,
): Promise<void> {
  if (getApiMode() !== 'live') {
    throw new Error('演示模式无法提交退货物流，请在正式环境操作');
  }
  await getStoreClient().submitReturnShipment(refundId, {
    carrier: carrier.trim(),
    tracking_number: trackingNumber.trim(),
  });
}
