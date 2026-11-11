import { checkPasswordStrength } from '@mall/policy';
import {
  DEFAULT_PROVIDERS,
  DEFAULT_THEME,
  SEED_ORDERS,
  SEED_PRODUCTS,
  type AdminOrder,
  type AdminSession,
  type ProductDraft,
  type ProviderConfig,
  type ThemeConfig,
} from './admin-data';

const KEYS = {
  session: 'admin:session',
  products: 'admin:products',
  orders: 'admin:orders',
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

export function refundOrder(id: string): void {
  updateOrder(id, (o) => {
    o.paymentStatus = 'refunded';
  });
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
