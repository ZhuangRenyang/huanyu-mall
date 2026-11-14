import { checkPasswordStrength } from '@mall/policy';
import {
  DEFAULT_PROVIDERS,
  DEFAULT_THEME,
  SEED_ORDERS,
  SEED_PRODUCTS,
  type AdminAffiliate,
  type AdminCommission,
  type AdminFlashSale,
  type AdminGroupBuy,
  type AdminInvoice,
  type AdminMemberLevel,
  type AdminOrder,
  type AdminRefundRequest,
  type AdminSession,
  type ProductDraft,
  type ProviderConfig,
  type ThemeConfig,
} from './admin-data';

const KEYS = {
  session: 'admin:session',
  products: 'admin:products',
  orders: 'admin:orders',
  refunds: 'admin:refund-requests',
  invoices: 'admin:invoices',
  flashSales: 'admin:flash-sales',
  groupBuys: 'admin:group-buys',
  affiliates: 'admin:affiliates',
  commissions: 'admin:commissions',
  memberLevels: 'admin:member-levels',
  theme: 'admin:theme',
  providers: 'admin:providers',
  password: 'admin:password',
  attempts: 'admin:password-attempts',
} as const;

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

// ---- 认证（mock admin JWT） ----

/** 演示账号的初始口令，与登录页提示一致；改密后由本地存储覆盖。 */
const DEFAULT_ADMIN_PASSWORD = '123456';

/** 严格档限流（对齐后端 RATE_LIMIT_AUTH_MAX / RATE_LIMIT_AUTH_WINDOW_MS）。 */
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;

interface AttemptState {
  count: number;
  windowStart: number;
}

export function getSession(): AdminSession | null {
  return read<AdminSession | null>(KEYS.session, null);
}

/** 当前生效的管理员口令（mock 模式本地保存，改密后即为此值）。 */
export function getAdminPassword(): string {
  return read<string>(KEYS.password, DEFAULT_ADMIN_PASSWORD);
}

function readAttempts(): AttemptState {
  return read<AttemptState>(KEYS.attempts, { count: 0, windowStart: 0 });
}

function writeAttempts(state: AttemptState): void {
  write(KEYS.attempts, state);
}

/** 是否处于限流窗口内（窗口自然过期即恢复）。 */
function isRateLimited(): boolean {
  const a = readAttempts();
  if (a.count < MAX_ATTEMPTS) return false;
  return Date.now() - a.windowStart < ATTEMPT_WINDOW_MS;
}

/** 记一次失败尝试；窗口过期则重新起算。 */
function recordFailure(): void {
  const now = Date.now();
  const a = readAttempts();
  const expired = now - a.windowStart >= ATTEMPT_WINDOW_MS;
  writeAttempts(expired ? { count: 1, windowStart: now } : { count: a.count + 1, windowStart: a.windowStart });
}

export function login(email: string, password: string): { ok: true } | { ok: false; error: string } {
  const id = email.trim().toLowerCase();
  if ((id !== 'admin' && id !== 'admin@example.com') || password !== getAdminPassword()) {
    return { ok: false, error: '账号或密码不正确' };
  }
  write(KEYS.session, { email: id, name: '店主 Alex', role: 'admin' } satisfies AdminSession);
  return { ok: true };
}

export function logout(): void {
  try {
    localStorage.removeItem(KEYS.session);
  } catch {
    /* noop */
  }
}

// ---- 改密（mock） ----

export interface MockChangePasswordResult {
  ok: boolean;
  /** 失败时的业务错误码（对齐后端 DomainError.code：10005 / 20001 / 60001）。 */
  code?: number;
  error?: string;
}

/**
 * mock 改密：校验当前口令 → 强度 → 与旧口令不同 → 本地保存新口令。
 * 校验顺序与后端一致（当前口令 → 强度 → 相同口令），失败文案也用后端同一套措辞。
 */
export function changePassword(currentPassword: string, newPassword: string): MockChangePasswordResult {
  if (isRateLimited()) {
    return { ok: false, code: 60001, error: '密码修改尝试过于频繁，请 1 分钟后再试' };
  }
  if (currentPassword !== getAdminPassword()) {
    recordFailure();
    return { ok: false, code: 10005, error: '当前口令不正确，请核对后重新输入' };
  }
  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) {
    return { ok: false, code: 20001, error: strength.reason };
  }
  if (newPassword === currentPassword) {
    return { ok: false, code: 20001, error: '新口令不能与当前口令相同' };
  }
  write(KEYS.password, newPassword);
  writeAttempts({ count: 0, windowStart: Date.now() });
  return { ok: true };
}

// ---- 商品 ----
export function listProducts(): ProductDraft[] {
  return read<ProductDraft[]>(KEYS.products, SEED_PRODUCTS);
}

export function saveProduct(product: ProductDraft): void {
  const list = listProducts();
  const idx = list.findIndex((p) => p.id === product.id);
  if (idx >= 0) list[idx] = product;
  else list.unshift(product);
  write(KEYS.products, list);
}

/** mock：整组覆盖商品（批量上架/下架/删除用）。 */
export function replaceProducts(list: ProductDraft[]): void {
  write(KEYS.products, list);
}

export function deleteProduct(id: string): void {
  write(
    KEYS.products,
    listProducts().filter((p) => p.id !== id),
  );
}

// ---- 订单 ----
export function listOrders(): AdminOrder[] {
  return read<AdminOrder[]>(KEYS.orders, SEED_ORDERS);
}

export function getOrder(id: string): AdminOrder | null {
  return listOrders().find((o) => o.id === id) ?? null;
}

/** mock：写商家备注（空串=清空）。 */
export function setOrderNote(id: string, note: string): void {
  updateOrder(id, (o) => {
    o.merchantNote = note.trim() === '' ? null : note.trim();
  });
}

function updateOrder(id: string, mutate: (o: AdminOrder) => void): void {
  const list = listOrders();
  const order = list.find((o) => o.id === id);
  if (order) {
    mutate(order);
    write(KEYS.orders, list);
  }
}

/**
 * mock 发货：跨仓订单要所有仓都发过才算「已发货」（真实后端由发货单状态决定）。
 * 这里没有发货单表，用本地记录已发货的仓近似，避免演示时发完第一个仓就再也点不到发货。
 */
const SHIPPED_LOCS_KEY = 'admin:order-shipped-locations';

/** mock：读某单已发过的仓（live 模式请用 listOrderFulfillments）。 */
export function listShippedLocations(id: string): string[] {
  return read<Record<string, string[]>>(SHIPPED_LOCS_KEY, {})[id] ?? [];
}

export function shipOrder(
  id: string,
  carrier: string,
  trackingNumber: string,
  opts?: { stockLocationId?: string; locationCount?: number },
): void {
  let allShipped = true;
  const stockLocationId = opts?.stockLocationId;
  if (stockLocationId) {
    const map = read<Record<string, string[]>>(SHIPPED_LOCS_KEY, {});
    const done = new Set([...(map[id] ?? []), stockLocationId]);
    map[id] = [...done];
    write(SHIPPED_LOCS_KEY, map);
    allShipped = done.size >= (opts?.locationCount ?? 1);
  }
  updateOrder(id, (o) => {
    o.carrier = carrier;
    o.trackingNumber = trackingNumber;
    if (allShipped) o.fulfillmentStatus = 'shipped';
  });
}

/**
 * mock：发起退款**申请**（不是直接退款）。
 *
 * 演示模式也必须走「申请 → 待处理 → 审核」这条路，
 * 否则界面上点一下钱就退了，和真实流程说的不是一回事。
 */
export function requestRefund(
  orderId: string,
  reason: string,
  source: 'customer' | 'merchant',
  resolution: 'refund_only' | 'return_refund' = 'refund_only',
): AdminRefundRequest {
  const order = getOrder(orderId);
  const before = order?.orderStatus ?? 'paid';
  const req: AdminRefundRequest = {
    id: `rfr_${Date.now().toString(36)}`,
    orderId,
    customerEmail: order?.customerEmail ?? null,
    amountMinor: order?.totalMinor ?? 0,
    currencyCode: order?.currency ?? 'CNY',
    reason,
    source,
    status: 'pending',
    resolution,
    returnAddress: null,
    returnCarrier: null,
    returnTrackingNumber: null,
    reviewNote: null,
    createdAt: new Date().toISOString(),
    refundId: null,
    orderStatusBefore: before,
    exchangeLabel: null,
    exchangeCarrier: null,
    exchangeTrackingNumber: null,
  };
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  write(KEYS.refunds, [req, ...list]);
  updateOrder(orderId, (o) => {
    o.orderStatus = 'refund_pending';
  });
  return req;
}

/**
 * mock：同意退款。
 *
 * 退货退款只推进到「待买家寄回」，**不动钱**（与真实实现同一语义）；
 * 仅退款才直接通过。
 */
export function approveRefund(id: string): void {
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  const req = list.find((r) => r.id === id);
  if (!req || req.status !== 'pending') return;
  if (req.resolution === 'return_refund') {
    req.status = 'awaiting_return';
    /*
     * 与真实实现同语义：地址在同意这一刻快照（ADR-061）。
     * mock 下店铺资料存在 localStorage 的 admin:store-profile 里，
     * 读它而不是读当前 settings 状态，演示里改地址也复现得出「老单不变」。
     */
    try {
      const raw = localStorage.getItem('admin:store-profile');
      const profile = raw ? (JSON.parse(raw) as { returnAddress?: string | null }) : null;
      req.returnAddress = profile?.returnAddress?.trim() ? profile.returnAddress.trim() : null;
    } catch {
      req.returnAddress = null;
    }
    write(KEYS.refunds, list);
    return;
  }
  req.status = 'approved';
  req.refundId = `rfd_${Date.now().toString(36)}`;
  write(KEYS.refunds, list);
  updateOrder(req.orderId, (o) => {
    o.orderStatus = 'refunded';
    o.paymentStatus = 'refunded';
  });
}

/** mock：确认收到退货并退款（退货退款的打款关卡）。 */
export function receiveReturn(id: string, note?: string): void {
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  const req = list.find((r) => r.id === id);
  if (!req || req.status !== 'returned') return;
  req.status = 'approved';
  req.refundId = `rfd_${Date.now().toString(36)}`;
  req.reviewNote = note?.trim() ? note.trim() : req.reviewNote;
  write(KEYS.refunds, list);
  updateOrder(req.orderId, (o) => {
    o.orderStatus = 'refunded';
    o.paymentStatus = 'refunded';
  });
}

/** mock：拒绝退款 → 订单回到申请前的状态。 */
export function rejectRefund(id: string, note: string): void {
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  const req = list.find((r) => r.id === id);
  if (!req || req.status !== 'pending') return;
  req.status = 'rejected';
  req.reviewNote = note.trim();
  write(KEYS.refunds, list);
  updateOrder(req.orderId, (o) => {
    o.orderStatus = req.orderStatusBefore ?? 'paid';
  });
}

/** mock：同意换货（ADR-090），不动钱。 */
export function agreeExchange(id: string, note?: string): void {
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  const req = list.find((r) => r.id === id);
  if (!req || req.status !== 'pending' || req.resolution !== 'exchange') return;
  req.status = 'awaiting_return';
  req.reviewNote = note?.trim() ? note.trim() : req.reviewNote;
  write(KEYS.refunds, list);
}

/** mock：确认收到换货退回（ADR-090），不动钱。 */
export function receiveExchange(id: string, note?: string): void {
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  const req = list.find((r) => r.id === id);
  if (!req || req.status !== 'returned') return;
  req.status = 'exchange_sending';
  if (note?.trim()) req.reviewNote = note.trim();
  write(KEYS.refunds, list);
}

/** mock：发出换货（ADR-090）。 */
export function shipExchange(id: string, carrier: string, trackingNumber: string): void {
  const list = read<AdminRefundRequest[]>(KEYS.refunds, []);
  const req = list.find((r) => r.id === id);
  if (!req || req.status !== 'exchange_sending') return;
  req.status = 'completed';
  req.exchangeCarrier = carrier.trim();
  req.exchangeTrackingNumber = trackingNumber.trim();
  write(KEYS.refunds, list);
}

/** mock：退款单列表（按状态过滤，倒序）。 */
export function listRefunds(status?: string): AdminRefundRequest[] {
  const all = read<AdminRefundRequest[]>(KEYS.refunds, []);
  return status ? all.filter((r) => r.status === status) : all;
}

// ---- 会员等级（ADR-102）----

/** mock：会员等级阶梯（首次访问给三档演示数据）。 */
export function listMemberLevels(): AdminMemberLevel[] {
  const raw = read<AdminMemberLevel[] | null>(KEYS.memberLevels, null);
  if (raw) return raw;
  const seed: AdminMemberLevel[] = [
    { id: 'lvl_1', name: '普通会员', thresholdMinor: 0, discountBps: 100 },
    { id: 'lvl_2', name: '银卡会员', thresholdMinor: 100000, discountBps: 300 },
    { id: 'lvl_3', name: '金卡会员', thresholdMinor: 500000, discountBps: 500 },
  ];
  write(KEYS.memberLevels, seed);
  return seed;
}

/** mock：新建/更新等级（id 为空则新建）。 */
export function saveMemberLevel(input: {
  id?: string;
  name?: string;
  thresholdMinor?: number;
  discountBps?: number;
}): void {
  const list = listMemberLevels();
  if (input.id) {
    const level = list.find((l) => l.id === input.id);
    if (!level) return;
    if (input.name !== undefined) level.name = input.name;
    if (input.thresholdMinor !== undefined) level.thresholdMinor = input.thresholdMinor;
    if (input.discountBps !== undefined) level.discountBps = input.discountBps;
  } else {
    list.push({
      id: `lvl_${Date.now()}`,
      name: input.name ?? '新等级',
      thresholdMinor: input.thresholdMinor ?? 0,
      discountBps: input.discountBps ?? 100,
    });
  }
  list.sort((a, b) => a.thresholdMinor - b.thresholdMinor);
  write(KEYS.memberLevels, list);
}

// ---- 分销（ADR-101）----

/** mock：推广员列表。首次访问按第一个客户造一个演示推广员。 */
export function listAffiliates(): AdminAffiliate[] {
  const raw = read<AdminAffiliate[] | null>(KEYS.affiliates, null);
  if (raw) return raw;
  const customers = read<Array<{ id: string }>>(KEYS.orders, []);
  void customers;
  const seed: AdminAffiliate[] = [
    {
      id: 'aff_demo_1',
      customerId: 'cust_1',
      code: 'HUANYU01',
      commissionBps: 500,
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  ];
  write(KEYS.affiliates, seed);
  return seed;
}

export function registerAffiliate(input: {
  customerId: string;
  code?: string;
  commissionBps: number;
}): void {
  const list = listAffiliates();
  list.unshift({
    id: `aff_${Date.now()}`,
    customerId: input.customerId,
    code: (input.code?.trim() || `AFF${String(Date.now()).slice(-6)}`).toUpperCase(),
    commissionBps: input.commissionBps,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
  write(KEYS.affiliates, list);
}

export function setAffiliateStatus(id: string, status: 'active' | 'disabled'): void {
  const list = listAffiliates();
  const a = list.find((x) => x.id === id);
  if (!a) return;
  a.status = status;
  write(KEYS.affiliates, list);
}

/** mock：佣金流水（首次访问造两条演示数据：一条待结算、一条已结算）。 */
export function listCommissions(status?: string): AdminCommission[] {
  const raw = read<AdminCommission[] | null>(KEYS.commissions, null);
  const all = raw ?? seedCommissions();
  return status ? all.filter((c) => c.status === status) : all;
}

function seedCommissions(): AdminCommission[] {
  const now = Date.now();
  const seed: AdminCommission[] = [
    {
      id: 'cm_demo_1',
      affiliateId: 'aff_demo_1',
      orderId: 'ord_2401',
      orderTotalMinor: 89900,
      commissionMinor: 4495,
      status: 'pending',
      settledAt: null,
      canceledReason: null,
      createdAt: new Date(now - 3_600_000).toISOString(),
    },
    {
      id: 'cm_demo_2',
      affiliateId: 'aff_demo_1',
      orderId: 'ord_2402',
      orderTotalMinor: 25900,
      commissionMinor: 1295,
      status: 'settled',
      settledAt: new Date(now - 86_400_000).toISOString(),
      canceledReason: null,
      createdAt: new Date(now - 2 * 86_400_000).toISOString(),
    },
  ];
  write(KEYS.commissions, seed);
  return seed;
}

/** mock：标记已结算（系统不转账，商家线下打款后点这里）。 */
export function settleCommission(id: string): void {
  const list = listCommissions();
  const c = list.find((x) => x.id === id);
  if (!c || c.status !== 'pending') return;
  c.status = 'settled';
  c.settledAt = new Date().toISOString();
  write(KEYS.commissions, list);
}

// ---- 拼团（ADR-100）----

/**
 * mock：拼团活动列表。
 *
 * 首次访问按第一个商品的第一个规格造一场「进行中」的两人团，
 * 演示环境可以直接参团看到成团流程。
 */
export function listGroupBuys(status?: string): AdminGroupBuy[] {
  const raw = read<AdminGroupBuy[] | null>(KEYS.groupBuys, null);
  const all = raw ?? seedGroupBuys();
  return status ? all.filter((g) => g.status === status) : all;
}

function seedGroupBuys(): AdminGroupBuy[] {
  const now = Date.now();
  const products = read<Array<{ id: string; title: string; variants: Array<{ id: string; title: string; priceMinor: number }> }>>(
    KEYS.products,
    [],
  );
  const product = products[0];
  const variant = product?.variants?.[0];
  const seed: AdminGroupBuy[] = [
    {
      id: 'gb_demo_1',
      name: '两人成团 · 立减 30',
      variantId: variant?.id ?? 'v5',
      productId: product?.id ?? 'prod_1',
      title: variant ? `${product?.title} · ${variant.title}` : '演示商品',
      originalPriceMinor: variant?.priceMinor ?? 89900,
      groupPriceMinor: Math.max(1, Math.round((variant?.priceMinor ?? 89900) * 0.85)),
      teamSize: 2,
      status: 'active',
      startsAt: new Date(now - 86_400_000).toISOString(),
      endsAt: new Date(now + 7 * 86_400_000).toISOString(),
      voucherId: 'vouch_gb_demo',
      createdAt: new Date(now - 90_000_000).toISOString(),
    },
  ];
  write(KEYS.groupBuys, seed);
  return seed;
}

/** mock：创建拼团活动（草稿）。 */
export function createGroupBuy(input: {
  name: string;
  variantId: string;
  productId: string;
  title: string;
  originalPriceMinor: number;
  groupPriceMinor: number;
  teamSize: number;
  startsAt: string;
  endsAt: string;
}): void {
  const list = listGroupBuys();
  const id = `gb_${Date.now()}`;
  list.unshift({
    id,
    name: input.name.trim(),
    variantId: input.variantId,
    productId: input.productId,
    title: input.title,
    originalPriceMinor: input.originalPriceMinor,
    groupPriceMinor: input.groupPriceMinor,
    teamSize: input.teamSize,
    status: 'draft',
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    voucherId: `vouch_${id}`,
    createdAt: new Date().toISOString(),
  });
  write(KEYS.groupBuys, list);
}

/** mock：上架 / 结束。 */
export function setGroupBuyStatus(id: string, status: 'active' | 'ended'): void {
  const list = listGroupBuys();
  const activity = list.find((g) => g.id === id);
  if (!activity) return;
  activity.status = status;
  write(KEYS.groupBuys, list);
}

// ---- 限时秒杀（ADR-099）----

/**
 * mock：秒杀活动列表。
 *
 * 首次访问造一场「进行中」的活动，演示环境进去就能看到可操作的数据；
 * 时间窗按访问时刻前后各一天，避免演示时活动已过期。
 */
export function listFlashSales(status?: string): AdminFlashSale[] {
  const raw = read<AdminFlashSale[] | null>(KEYS.flashSales, null);
  const all = raw ?? seedFlashSales();
  return status ? all.filter((s) => s.status === status) : all;
}

function seedFlashSales(): AdminFlashSale[] {
  const now = Date.now();
  const products = read<Array<{ id: string; title: string; variants: Array<{ id: string; title: string; priceMinor: number }> }>>(
    KEYS.products,
    [],
  );
  const product = products[0];
  const variant = product?.variants?.[0];
  const seed: AdminFlashSale[] = [
    {
      id: 'fs_demo_1',
      name: '限时秒杀 · 今日开抢',
      status: 'active',
      startsAt: new Date(now - 86_400_000).toISOString(),
      endsAt: new Date(now + 86_400_000).toISOString(),
      createdAt: new Date(now - 90_000_000).toISOString(),
      items: variant
        ? [
            {
              id: 'fsi_demo_1',
              flashSaleId: 'fs_demo_1',
              variantId: variant.id,
              title: `${product.title} · ${variant.title}`,
              originalPriceMinor: variant.priceMinor,
              // 八折，且至少比原价低 1 分
              flashPriceMinor: Math.max(1, Math.round(variant.priceMinor * 0.8)),
              stock: 20,
              sold: 3,
            },
          ]
        : [],
    },
  ];
  write(KEYS.flashSales, seed);
  return seed;
}

/** mock：创建秒杀活动（草稿）。 */
export function createFlashSale(input: {
  name: string;
  startsAt: string;
  endsAt: string;
  items: Array<{
    variantId: string;
    title: string;
    originalPriceMinor: number;
    flashPriceMinor: number;
    stock: number;
  }>;
}): void {
  const list = listFlashSales();
  const id = `fs_${Date.now()}`;
  list.unshift({
    id,
    name: input.name.trim(),
    status: 'draft',
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdAt: new Date().toISOString(),
    items: input.items.map((it, i) => ({
      id: `${id}_${i}`,
      flashSaleId: id,
      variantId: it.variantId,
      title: it.title,
      originalPriceMinor: it.originalPriceMinor,
      flashPriceMinor: it.flashPriceMinor,
      stock: it.stock,
      sold: 0,
    })),
  });
  write(KEYS.flashSales, list);
}

/** mock：上架 / 结束。 */
export function setFlashSaleStatus(id: string, status: 'active' | 'ended'): void {
  const list = listFlashSales();
  const sale = list.find((s) => s.id === id);
  if (!sale) return;
  sale.status = status;
  write(KEYS.flashSales, list);
}

// ---- 发票（ADR-098）----

/**
 * mock：发票单列表。
 *
 * 首次访问时按种子订单造一张「待开票」的单，演示环境点开就有东西可操作。
 * 不造已开票的：让商家能完整走一遍「登记发票号」的动作。
 */
export function listInvoices(status?: string): AdminInvoice[] {
  const raw = read<AdminInvoice[] | null>(KEYS.invoices, null);
  const all = raw ?? seedInvoices();
  return status ? all.filter((i) => i.status === status) : all;
}

function seedInvoices(): AdminInvoice[] {
  const order = listOrders()[0];
  const seed: AdminInvoice[] = [
    {
      id: 'inv_demo_1',
      orderId: order?.id ?? 'ord_2401',
      type: 'company',
      title: '深圳林氏科技有限公司',
      taxId: '91440300MA5FXYZ123',
      email: order?.customerEmail ?? 'lin@example.com',
      amountMinor: order?.totalMinor ?? 89900,
      currencyCode: order?.currency ?? 'CNY',
      remark: '请开明细',
      status: 'pending',
      invoiceNo: null,
      issuedAt: null,
      reviewNote: null,
      createdAt: '2026-11-13 09:40',
    },
  ];
  write(KEYS.invoices, seed);
  return seed;
}

/** mock：登记开票。 */
export function issueInvoice(id: string, invoiceNo: string, note?: string): void {
  const list = listInvoices();
  const inv = list.find((i) => i.id === id);
  if (!inv || inv.status !== 'pending') return;
  inv.status = 'issued';
  inv.invoiceNo = invoiceNo.trim();
  inv.issuedAt = new Date().toISOString();
  inv.reviewNote = note?.trim() ? note.trim() : null;
  write(KEYS.invoices, list);
}

/** mock：拒绝开票。 */
export function rejectInvoice(id: string, note: string): void {
  const list = listInvoices();
  const inv = list.find((i) => i.id === id);
  if (!inv || inv.status !== 'pending') return;
  inv.status = 'rejected';
  inv.reviewNote = note.trim();
  write(KEYS.invoices, list);
}

// ---- 主题 ----
export function getTheme(): ThemeConfig {
  return read<ThemeConfig>(KEYS.theme, DEFAULT_THEME);
}

export function saveTheme(theme: ThemeConfig): void {
  write(KEYS.theme, theme);
}

// ---- 支付 Provider ----
export function getProviders(): ProviderConfig[] {
  return read<ProviderConfig[]>(KEYS.providers, DEFAULT_PROVIDERS);
}

export function saveProviders(providers: ProviderConfig[]): void {
  write(KEYS.providers, providers);
}

// ---- id 生成 ----
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 4096).toString(36)}`;
}
