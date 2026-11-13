/**
 * 促销域：优惠券（voucher）+ 礼品卡（gift card）。
 *
 * 后端字段（snake_case / minor unit）→ 界面视图模型（camelCase）只在这里发生。
 * 金额一律 minor unit（分），展示换算见 @mall/ui formatMoney。
 *
 * mock 模式：本地 localStorage 种子数据，零依赖可演示；
 * live 模式：真调 Admin API（RBAC requirePermission("settings")）。
 */
import { ApiError } from '@mall/sdk';
import type {
  AdminGiftCard,
  AdminGiftCardEvent,
  AdminPromotion,
  AdminPromotionRule,
  AdminVoucher,
  AdminVoucherCode,
} from '@mall/sdk';
import { adminClient, getAdminApiMode } from './admin-client';

// ------------------------------------------------------------------ *
// 视图模型
// ------------------------------------------------------------------ *

export interface VoucherScopeView {
  scopeType: 'product' | 'category';
  scopeId: string;
}

export interface VoucherView {
  id: string;
  name: string;
  type: 'entire_order' | 'shipping' | 'specific_product';
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  minSpent: number | null;
  usageLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  status: 'active' | 'disabled';
  /** 店面公开可领（店铺券）；false = 只能凭码使用。 */
  isPublic: boolean;
  /** 每人限领张数。 */
  collectLimit: number;
  /** 适用范围（ADR-064）：type='specific_product' 时非空。 */
  scopes: VoucherScopeView[];
}

export interface VoucherCodeView {
  id: string;
  voucherId: string;
  code: string;
  used: number;
  isActive: boolean;
}

export interface VoucherDetailView extends VoucherView {
  codes: VoucherCodeView[];
}

export interface GiftCardView {
  id: string;
  code: string;
  currency: string;
  initialBalance: number;
  currentBalance: number;
  isActive: boolean;
  expiresAt: string | null;
  assignedTo: string | null;
}

export interface GiftCardEventView {
  id: string;
  giftCardId: string;
  type: string;
  amount: number;
  orderId: string | null;
  createdAt: string;
}

export interface VoucherInput {
  name: string;
  type: 'entire_order' | 'shipping' | 'specific_product';
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  minSpent: number | null;
  usageLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  /** 可选：管理员指定的券码列表（逗号分隔），留空则由后端生成。 */
  codes?: string[];
  /** 店面公开可领（店铺券）。 */
  isPublic: boolean;
  /** 每人限领。 */
  collectLimit: number;
  /** 适用范围（ADR-064）：仅 type='specific_product' 时传。 */
  scopes?: VoucherScopeView[];
}

export interface GiftCardInput {
  currency: string;
  initialBalance: number;
  expiresAt: string | null;
  assignedTo: string | null;
}

// ------------------------------------------------------------------ *
// 映射
// ------------------------------------------------------------------ *

function mapVoucher(v: AdminVoucher): VoucherView {
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    discountType: v.discount_type,
    discountValue: v.discount_value,
    minSpent: v.min_spent,
    usageLimit: v.usage_limit,
    startsAt: v.starts_at,
    endsAt: v.ends_at,
    status: v.status,
    isPublic: v.is_public ?? false,
    collectLimit: v.collect_limit ?? 1,
    scopes: (v.scopes ?? []).map((sc) => ({ scopeType: sc.scope_type, scopeId: sc.scope_id })),
  };
}

function mapCode(c: AdminVoucherCode): VoucherCodeView {
  return {
    id: c.id,
    voucherId: c.voucher_id,
    code: c.code,
    used: c.used,
    isActive: c.is_active,
  };
}

function mapGiftCard(g: AdminGiftCard): GiftCardView {
  return {
    id: g.id,
    code: g.code,
    currency: g.currency,
    initialBalance: g.initial_balance,
    currentBalance: g.current_balance,
    isActive: g.is_active,
    expiresAt: g.expires_at,
    assignedTo: g.assigned_to,
  };
}

function mapEvent(e: AdminGiftCardEvent): GiftCardEventView {
  return {
    id: e.id,
    giftCardId: e.gift_card_id,
    type: e.type,
    amount: e.amount,
    orderId: e.order_id,
    createdAt: e.created_at,
  };
}

// ------------------------------------------------------------------ *
// mock（localStorage 种子数据）
// ------------------------------------------------------------------ *

const KEYS = {
  vouchers: 'admin:vouchers',
  giftCards: 'admin:gift-cards',
  promotions: 'admin:promotions',
} as const;

const SEED_VOUCHERS: VoucherView[] = [
  {
    id: 'vc_demo1',
    name: '满 100 减 20',
    type: 'entire_order',
    discountType: 'fixed',
    discountValue: 2000,
    minSpent: 10000,
    usageLimit: 100,
    startsAt: null,
    endsAt: null,
    status: 'active',
    isPublic: true,
    collectLimit: 1,
    scopes: [],
  },
];

const SEED_GIFT_CARDS: GiftCardView[] = [
  {
    id: 'gc_demo1',
    code: 'GC-DEMO0001',
    currency: 'CNY',
    initialBalance: 5000,
    currentBalance: 5000,
    isActive: true,
    expiresAt: null,
    assignedTo: null,
  },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage 不可用 */
  }
}

function newMockId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 4096).toString(36)}`;
}

function mockListVouchers(): VoucherView[] {
  return read<VoucherView[]>(KEYS.vouchers, SEED_VOUCHERS);
}

function mockSaveVoucher(v: VoucherView): void {
  const list = mockListVouchers();
  const idx = list.findIndex((x) => x.id === v.id);
  if (idx >= 0) list[idx] = v;
  else list.unshift(v);
  write(KEYS.vouchers, list);
}

function mockListGiftCards(): GiftCardView[] {
  return read<GiftCardView[]>(KEYS.giftCards, SEED_GIFT_CARDS);
}

function mockSaveGiftCard(g: GiftCardView): void {
  const list = mockListGiftCards();
  const idx = list.findIndex((x) => x.id === g.id);
  if (idx >= 0) list[idx] = g;
  else list.unshift(g);
  write(KEYS.giftCards, list);
}

// ------------------------------------------------------------------ *
// 列表查询（三张表共用形状）
// ------------------------------------------------------------------ *

export interface PromoListParams {
  /** 关键字：促销/券按名称，礼品卡按卡号。 */
  q?: string;
  /** 促销专用：类型与状态。 */
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface PromoListResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/** 列表在服务端分页：mock 模式本地切页，口径与线上一致。 */
function pageOf<T>(all: T[], limit: number, offset: number): PromoListResult<T> {
  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    hasMore: offset + limit < all.length,
  };
}

// ------------------------------------------------------------------ *
// 对外接口（优惠券）
// ------------------------------------------------------------------ *

export async function listVouchers(params: PromoListParams = {}): Promise<PromoListResult<VoucherView>> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  if (getAdminApiMode() !== 'live') {
    let all = mockListVouchers();
    if (params.q) {
      const needle = params.q.trim().toLowerCase();
      all = all.filter((v) => v.name.toLowerCase().includes(needle));
    }
    return pageOf(all, limit, offset);
  }
  const res = (await adminClient().listVouchers({
    limit,
    offset,
    ...(params.q ? { q: params.q } : {}),
  })) as { items?: AdminVoucher[]; count?: number; hasMore?: boolean };
  const items = (res.items ?? []).map(mapVoucher);
  return { items, total: res.count ?? items.length, hasMore: res.hasMore === true };
}

export async function getVoucher(id: string): Promise<VoucherDetailView | null> {
  if (getAdminApiMode() !== 'live') {
    const v = mockListVouchers().find((x) => x.id === id);
    return v ? { ...v, codes: [] } : null;
  }
  try {
    const res = (await adminClient().getVoucher(id)) as AdminVoucher & { codes?: AdminVoucherCode[] };
    return { ...mapVoucher(res), codes: (res.codes ?? []).map(mapCode) };
  } catch {
    return null;
  }
}

export async function createVoucher(input: VoucherInput): Promise<VoucherDetailView> {
  if (getAdminApiMode() !== 'live') {
    const v: VoucherView = {
      id: newMockId('vc'),
      name: input.name,
      type: input.type,
      discountType: input.discountType,
      discountValue: input.discountValue,
      minSpent: input.minSpent,
      usageLimit: input.usageLimit,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: 'active',
      isPublic: input.isPublic,
      collectLimit: input.collectLimit,
      scopes: input.scopes ?? [],
    };
    mockSaveVoucher(v);
    return { ...v, codes: [] };
  }
  const res = (await adminClient().createVoucher({
    name: input.name,
    type: input.type,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    min_spent: input.minSpent,
    usage_limit: input.usageLimit,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    is_public: input.isPublic,
    collect_limit: input.collectLimit,
    ...(input.codes && input.codes.length > 0 ? { codes: input.codes } : {}),
    ...(input.scopes && input.scopes.length > 0
      ? { scopes: input.scopes.map((sc) => ({ scope_type: sc.scopeType, scope_id: sc.scopeId })) }
      : {}),
  })) as AdminVoucher & { codes?: AdminVoucherCode[] };
  return { ...mapVoucher(res), codes: (res.codes ?? []).map(mapCode) };
}

export async function updateVoucher(id: string, input: VoucherInput): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const v = mockListVouchers().find((x) => x.id === id);
    if (v) {
      Object.assign(v, {
        name: input.name,
        type: input.type,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minSpent: input.minSpent,
        usageLimit: input.usageLimit,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isPublic: input.isPublic,
        collectLimit: input.collectLimit,
        scopes: input.scopes ?? [],
      });
      mockSaveVoucher(v);
    }
    return;
  }
  await adminClient().updateVoucher(id, {
    name: input.name,
    type: input.type,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    min_spent: input.minSpent,
    usage_limit: input.usageLimit,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    is_public: input.isPublic,
    collect_limit: input.collectLimit,
    ...(input.scopes && input.scopes.length > 0
      ? { scopes: input.scopes.map((sc) => ({ scope_type: sc.scopeType, scope_id: sc.scopeId })) }
      : {}),
  });
}

export async function setVoucherStatus(id: string, active: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const v = mockListVouchers().find((x) => x.id === id);
    if (v) {
      v.status = active ? 'active' : 'disabled';
      mockSaveVoucher(v);
    }
    return;
  }
  const client = adminClient();
  if (active) await client.enableVoucher(id);
  else await client.disableVoucher(id);
}

// —— 券码管理 ——

export async function listVoucherCodes(id: string): Promise<VoucherCodeView[]> {
  if (getAdminApiMode() !== 'live') return [];
  const res = (await adminClient().listVoucherCodes(id)) as { items?: AdminVoucherCode[] };
  return (res.items ?? []).map(mapCode);
}

export async function addVoucherCodes(id: string, codes: string[]): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  await adminClient().addVoucherCodes(id, { codes });
}

export async function deleteVoucherCode(id: string, codeId: string): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  try {
    await adminClient().deleteVoucherCode(id, codeId);
  } catch (err) {
    // 后端返回 204 无响应体，SDK 按「JSON 解析失败」抛 ApiError(204) —— 删除成功。
    if (!(err instanceof ApiError && err.code === 204)) throw err;
  }
}

export async function setVoucherCodeStatus(id: string, codeId: string, active: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  const client = adminClient();
  if (active) await client.enableVoucherCode(id, codeId);
  else await client.disableVoucherCode(id, codeId);
}

// ------------------------------------------------------------------ *
// 对外接口（礼品卡）
// ------------------------------------------------------------------ *

export async function listGiftCards(params: PromoListParams = {}): Promise<PromoListResult<GiftCardView>> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  if (getAdminApiMode() !== 'live') {
    let all = mockListGiftCards();
    if (params.q) {
      const needle = params.q.trim().toLowerCase();
      all = all.filter((g) => g.code.toLowerCase().includes(needle));
    }
    return pageOf(all, limit, offset);
  }
  const res = (await adminClient().listGiftCards({
    limit,
    offset,
    ...(params.q ? { q: params.q } : {}),
  })) as { items?: AdminGiftCard[]; count?: number; hasMore?: boolean };
  const items = (res.items ?? []).map(mapGiftCard);
  return { items, total: res.count ?? items.length, hasMore: res.hasMore === true };
}

export async function getGiftCard(id: string): Promise<GiftCardView | null> {
  if (getAdminApiMode() !== 'live') return mockListGiftCards().find((x) => x.id === id) ?? null;
  try {
    const res = (await adminClient().getGiftCard(id)) as AdminGiftCard;
    return mapGiftCard(res);
  } catch {
    return null;
  }
}

export async function createGiftCard(input: GiftCardInput): Promise<GiftCardView> {
  if (getAdminApiMode() !== 'live') {
    const g: GiftCardView = {
      id: newMockId('gc'),
      code: `GC-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
      currency: input.currency,
      initialBalance: input.initialBalance,
      currentBalance: input.initialBalance,
      isActive: true,
      expiresAt: input.expiresAt,
      assignedTo: input.assignedTo,
    };
    mockSaveGiftCard(g);
    return g;
  }
  const res = (await adminClient().createGiftCard({
    currency: input.currency,
    initial_balance: input.initialBalance,
    expires_at: input.expiresAt,
    assigned_to: input.assignedTo,
  })) as AdminGiftCard;
  return mapGiftCard(res);
}

export async function updateGiftCard(
  id: string,
  patch: { expiresAt: string | null; assignedTo: string | null },
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const g = mockListGiftCards().find((x) => x.id === id);
    if (g) {
      g.expiresAt = patch.expiresAt;
      g.assignedTo = patch.assignedTo;
      mockSaveGiftCard(g);
    }
    return;
  }
  await adminClient().updateGiftCard(id, {
    expires_at: patch.expiresAt,
    assigned_to: patch.assignedTo,
  });
}

export async function setGiftCardStatus(id: string, active: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const g = mockListGiftCards().find((x) => x.id === id);
    if (g) {
      g.isActive = active;
      mockSaveGiftCard(g);
    }
    return;
  }
  const client = adminClient();
  if (active) await client.enableGiftCard(id);
  else await client.disableGiftCard(id);
}

export async function adjustGiftCard(id: string, deltaMinor: number, reason: string): Promise<GiftCardView | null> {
  if (getAdminApiMode() !== 'live') {
    const g = mockListGiftCards().find((x) => x.id === id);
    if (g) {
      g.currentBalance = Math.max(0, g.currentBalance + deltaMinor);
      mockSaveGiftCard(g);
      return g;
    }
    return null;
  }
  try {
    const res = (await adminClient().adjustGiftCard(id, {
      delta_minor: deltaMinor,
      reason: reason || undefined,
    })) as AdminGiftCard;
    return mapGiftCard(res);
  } catch {
    return null;
  }
}

export async function listGiftCardEvents(id: string): Promise<GiftCardEventView[]> {
  if (getAdminApiMode() !== 'live') return [];
  const res = (await adminClient().listGiftCardEvents(id)) as { items?: AdminGiftCardEvent[] };
  return (res.items ?? []).map(mapEvent);
}

/** 流水类型 → 中文标签（后台展示用）。 */
export function giftCardEventLabel(type: string): string {
  const map: Record<string, string> = {
    issued: '开卡',
    used_in_order: '订单抵扣',
    refunded_in_order: '订单退款返还',
    balance_adjusted: '手动调账',
    deactivated: '停用',
    activated: '启用',
  };
  return map[type] ?? type;
}

// ------------------------------------------------------------------ *
// 目录 / 订单促销（promotion 表）
// ------------------------------------------------------------------ *

export interface PromotionRuleView {
  id: string;
  promotionId: string;
  predicate: Record<string, unknown>;
  rewardType: 'fixed' | 'percentage';
  rewardValue: number;
  allocation: 'each' | 'across' | 'once' | null;
}

export interface PromotionView {
  id: string;
  name: string;
  code: string | null;
  type: 'catalogue' | 'order';
  status: 'draft' | 'active' | 'inactive';
  isAutomatic: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  used: number;
}

export interface PromotionDetailView extends PromotionView {
  rules: PromotionRuleView[];
}

/** 新建促销：一条规则随促销一起建（多规则在详情里追加）。 */
export interface PromotionInput {
  name: string;
  type: 'catalogue' | 'order';
  isAutomatic: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  predicate: Record<string, unknown>;
  rewardType: 'fixed' | 'percentage';
  rewardValue: number;
}

function mapPromotionRule(r: AdminPromotionRule): PromotionRuleView {
  return {
    id: r.id,
    promotionId: r.promotion_id,
    predicate: r.predicate,
    rewardType: r.reward_type,
    rewardValue: r.reward_value,
    allocation: r.allocation,
  };
}

function mapPromotion(p: AdminPromotion): PromotionView {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    type: p.type,
    status: p.status,
    isAutomatic: p.is_automatic,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    usageLimit: p.usage_limit,
    used: p.used,
  };
}

const SEED_PROMOTIONS: PromotionDetailView[] = [
  {
    id: 'promo_demo1',
    name: '满 200 减 30',
    code: null,
    type: 'order',
    status: 'active',
    isAutomatic: true,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    used: 0,
    rules: [
      {
        id: 'prorul_demo1',
        promotionId: 'promo_demo1',
        predicate: { subtotalGte: 20000 },
        rewardType: 'fixed',
        rewardValue: 3000,
        allocation: null,
      },
    ],
  },
];

function mockListPromotions(): PromotionDetailView[] {
  return read<PromotionDetailView[]>(KEYS.promotions, SEED_PROMOTIONS);
}

function mockSavePromotion(p: PromotionDetailView): void {
  const list = mockListPromotions();
  const idx = list.findIndex((x) => x.id === p.id);
  if (idx >= 0) list[idx] = p;
  else list.unshift(p);
  write(KEYS.promotions, list);
}

export async function listPromotions(params: PromoListParams = {}): Promise<PromoListResult<PromotionView>> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  if (getAdminApiMode() !== 'live') {
    let all = mockListPromotions();
    if (params.type) all = all.filter((p) => p.type === params.type);
    if (params.status) all = all.filter((p) => p.status === params.status);
    if (params.q) {
      const needle = params.q.trim().toLowerCase();
      all = all.filter(
        (p) => p.name.toLowerCase().includes(needle) || (p.code ?? '').toLowerCase().includes(needle),
      );
    }
    return pageOf(all, limit, offset);
  }
  const res = (await adminClient().listPromotions({
    limit,
    offset,
    ...(params.q ? { q: params.q } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.status ? { status: params.status } : {}),
  })) as { items?: AdminPromotion[]; count?: number; hasMore?: boolean };
  const items = (res.items ?? []).map(mapPromotion);
  return { items, total: res.count ?? items.length, hasMore: res.hasMore === true };
}

export async function getPromotion(id: string): Promise<PromotionDetailView | null> {
  if (getAdminApiMode() !== 'live') return mockListPromotions().find((x) => x.id === id) ?? null;
  try {
    const res = (await adminClient().getPromotion(id)) as AdminPromotion & { rules?: AdminPromotionRule[] };
    return { ...mapPromotion(res), rules: (res.rules ?? []).map(mapPromotionRule) };
  } catch {
    return null;
  }
}

export async function createPromotion(input: PromotionInput): Promise<PromotionDetailView> {
  if (getAdminApiMode() !== 'live') {
    const id = newMockId('promo');
    const p: PromotionDetailView = {
      id,
      name: input.name,
      code: null,
      type: input.type,
      status: 'draft',
      isAutomatic: input.isAutomatic,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      usageLimit: input.usageLimit,
      used: 0,
      rules: [
        {
          id: newMockId('prorul'),
          promotionId: id,
          predicate: input.predicate,
          rewardType: input.rewardType,
          rewardValue: input.rewardValue,
          allocation: null,
        },
      ],
    };
    mockSavePromotion(p);
    return p;
  }
  const res = (await adminClient().createPromotion({
    name: input.name,
    type: input.type,
    is_automatic: input.isAutomatic,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    usage_limit: input.usageLimit,
    rules: [
      {
        predicate: input.predicate as never,
        reward_type: input.rewardType,
        reward_value: input.rewardValue,
      },
    ],
  })) as AdminPromotion & { rules?: AdminPromotionRule[] };
  return { ...mapPromotion(res), rules: (res.rules ?? []).map(mapPromotionRule) };
}

export async function setPromotionStatus(id: string, active: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const p = mockListPromotions().find((x) => x.id === id);
    if (p) {
      p.status = active ? 'active' : 'inactive';
      mockSavePromotion(p);
    }
    return;
  }
  const client = adminClient();
  if (active) await client.activatePromotion(id);
  else await client.deactivatePromotion(id);
}

export async function deletePromotion(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    write(
      KEYS.promotions,
      mockListPromotions().filter((x) => x.id !== id),
    );
    return;
  }
  try {
    await adminClient().deletePromotion(id);
  } catch (err) {
    // 后端 204 无响应体，SDK 按 JSON 解析失败抛 ApiError(204) —— 删除成功。
    if (!(err instanceof ApiError && err.code === 204)) throw err;
  }
}

export async function addPromotionRule(
  promotionId: string,
  input: { predicate: Record<string, unknown>; rewardType: 'fixed' | 'percentage'; rewardValue: number },
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const p = mockListPromotions().find((x) => x.id === promotionId);
    if (p) {
      p.rules.push({
        id: newMockId('prorul'),
        promotionId,
        predicate: input.predicate,
        rewardType: input.rewardType,
        rewardValue: input.rewardValue,
        allocation: null,
      });
      mockSavePromotion(p);
    }
    return;
  }
  await adminClient().addPromotionRule(promotionId, {
    predicate: input.predicate as never,
    reward_type: input.rewardType,
    reward_value: input.rewardValue,
  });
}

export async function deletePromotionRule(ruleId: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = mockListPromotions().map((p) => ({ ...p, rules: p.rules.filter((r) => r.id !== ruleId) }));
    write(KEYS.promotions, list);
    return;
  }
  try {
    await adminClient().deletePromotionRule(ruleId);
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 204)) throw err;
  }
}

// ------------------------------------------------------------------ *
// 营销功能级开关（默认全关，各页面独立打开）
// ------------------------------------------------------------------ *

export type MarketingFeature = 'promotion' | 'voucher' | 'gift_card';

export interface MarketingFeatureFlags {
  promotion: boolean;
  voucher: boolean;
  gift_card: boolean;
}

const FEATURE_KEY = 'admin:marketing-features';

const DEFAULT_FEATURES: MarketingFeatureFlags = {
  promotion: false,
  voucher: false,
  gift_card: false,
};

export async function getMarketingFeatures(): Promise<MarketingFeatureFlags> {
  if (getAdminApiMode() !== 'live') {
    return { ...DEFAULT_FEATURES, ...read<Partial<MarketingFeatureFlags>>(FEATURE_KEY, {}) };
  }
  return (await adminClient().getMarketingFeatures()) as MarketingFeatureFlags;
}

export async function setMarketingFeature(feature: MarketingFeature, enabled: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const current = { ...DEFAULT_FEATURES, ...read<Partial<MarketingFeatureFlags>>(FEATURE_KEY, {}) };
    write(FEATURE_KEY, { ...current, [feature]: enabled });
    return;
  }
  await adminClient().setMarketingFeature(feature, enabled);
}
