/**
 * 活动总览：把三类活动（促销 / 优惠券 / 礼品卡）汇总成一张列表，供后台集中开关。
 *
 * 为什么要有这一层：商家不该记住「这个活动在哪个 tab」，也不该为了停一个活动翻三个页面。
 * 这里只做聚合与开关，不新增任何活动类型（ADR-014：不做营销玩法）。
 */
import { formatMoney } from '@mall/ui';
import {
  listGiftCards,
  listPromotions,
  listVouchers,
  setGiftCardStatus,
  setPromotionStatus,
  setVoucherStatus,
} from './admin-promotions';

export type ActivityKind = 'promotion' | 'voucher' | 'gift_card';

export interface ActivityView {
  /** 唯一键：`${kind}:${id}`。 */
  key: string;
  id: string;
  kind: ActivityKind;
  name: string;
  /** 优惠内容的一句话摘要。 */
  summary: string;
  active: boolean;
  /** 有效期 / 余额等补充。 */
  note: string;
}

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  promotion: '促销',
  voucher: '优惠券',
  gift_card: '礼品卡',
};

const PROMOTION_TYPE_LABEL: Record<'catalogue' | 'order', string> = {
  catalogue: '商品折扣',
  order: '订单满减',
};

function periodNote(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return '长期有效';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('zh-CN');
  return `${startsAt ? fmt(startsAt) : '即刻'} ~ ${endsAt ? fmt(endsAt) : '长期'}`;
}

function voucherSummary(v: {
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  minSpent: number | null;
}): string {
  const off =
    v.discountType === 'fixed'
      ? `减 ${formatMoney(v.discountValue, 'CNY')}`
      : `减 ${(v.discountValue / 100).toString()}%`;
  return v.minSpent != null ? `满 ${formatMoney(v.minSpent, 'CNY')} ${off}` : off;
}

export async function listActivities(): Promise<ActivityView[]> {
  // 任一域失败不影响其它域展示；整体失败由调用方兜底为空列表。
  const [promotions, vouchers, giftCards] = await Promise.all([
    listPromotions().catch(() => []),
    listVouchers().catch(() => []),
    listGiftCards().catch(() => []),
  ]);

  const items: ActivityView[] = [];

  for (const p of promotions) {
    items.push({
      key: `promotion:${p.id}`,
      id: p.id,
      kind: 'promotion',
      name: p.name,
      // 列表接口不带规则；摘要写类型与触发方式，具体优惠在「促销」页看。
      summary: `${PROMOTION_TYPE_LABEL[p.type]} · ${p.isAutomatic ? '自动命中' : '需输码'}`,
      active: p.status === 'active',
      note: `${periodNote(p.startsAt, p.endsAt)}${p.usageLimit != null ? ` · 限 ${p.usageLimit} 次` : ''}`,
    });
  }

  for (const v of vouchers) {
    items.push({
      key: `voucher:${v.id}`,
      id: v.id,
      kind: 'voucher',
      name: v.name,
      summary: voucherSummary(v),
      active: v.status === 'active',
      note: periodNote(v.startsAt, v.endsAt),
    });
  }

  for (const g of giftCards) {
    items.push({
      key: `gift_card:${g.id}`,
      id: g.id,
      kind: 'gift_card',
      name: g.code,
      summary: `余额 ${formatMoney(g.currentBalance, g.currency)} / 初始 ${formatMoney(g.initialBalance, g.currency)}`,
      active: g.isActive,
      note: g.expiresAt ? `有效期至 ${new Date(g.expiresAt).toLocaleDateString('zh-CN')}` : '长期有效',
    });
  }

  return items;
}

export async function setActivityActive(item: ActivityView, active: boolean): Promise<void> {
  switch (item.kind) {
    case 'promotion':
      await setPromotionStatus(item.id, active);
      return;
    case 'voucher':
      await setVoucherStatus(item.id, active);
      return;
    case 'gift_card':
      await setGiftCardStatus(item.id, active);
      return;
  }
}

/** 一键停用所有「当前启用」的活动；返回实际停用数量（串行，避免并发打爆后台接口）。 */
export async function disableAllActivities(items: ActivityView[]): Promise<number> {
  const active = items.filter((i) => i.active);
  for (const item of active) {
    await setActivityActive(item, false);
  }
  return active.length;
}
