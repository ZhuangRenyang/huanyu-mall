/**
 * 顾客账户数据层。
 *
 * live：真实调 `/store/auth/*` 与 `/store/customer/*`，token 存 localStorage
 *      （跨标签、关浏览器仍在 —— 之前存 sessionStorage，换个标签就掉登录）。
 * mock：本地演示账号（demo@example.com / demo1234），无后端也能预览。
 *
 * 不导入 `lib/api.ts`：那里要用本模块的 token 做请求头，反向导入会成环。
 * 因此这里直接用 fetch 拼同样的 `/api/v1` 路径。
 */

const LIVE = process.env.NEXT_PUBLIC_API_MODE === "live";
/** 给 UI 判断「现在是不是演示模式」（演示模式的验证码提示、演示账号提示只在 mock 下显示）。 */
export const ACCOUNT_LIVE = LIVE;
/** 浏览器同源（nginx 反代 /api）；SSR 直连容器。 */
const BASE =
  typeof window === "undefined" ? (process.env.API_INTERNAL_URL ?? "http://api:3000") : "";

export interface CustomerProfile {
  id: string;
  /** 手机号注册的顾客没有邮箱（ADR-025）。 */
  email: string | null;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

export interface AddressRecord {
  id: string;
  name: string;
  phone: string;
  region: string;
  line1: string;
  isDefault: boolean;
}

export interface AddressInput {
  name: string;
  phone: string;
  region: string;
  line1: string;
  isDefault?: boolean;
}

interface Tokens {
  access: string;
  refresh: string;
}

const TOKENS_KEY = "customer:tokens";
const PROFILE_KEY = "customer:profile";
/** mock 模式沿用的键（与 live 分开，避免演示数据污染真实登录态）。 */
const MOCK_USERS_KEY = "account:users";
const MOCK_SESSION_KEY = "account:session";
const MOCK_ADDRESS_KEY = "account:addresses";

function read<T>(key: string, fallback: T, storage: "local" | "session"): T {
  try {
    const s = storage === "local" ? localStorage : sessionStorage;
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, storage: "local" | "session"): void {
  try {
    const s = storage === "local" ? localStorage : sessionStorage;
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式或配额满：登录态只在内存里，功能降级但不崩 */
  }
}

function remove(key: string, storage: "local" | "session"): void {
  try {
    const s = storage === "local" ? localStorage : sessionStorage;
    s.removeItem(key);
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------- *
// token 读写（供 lib/api.ts 注入请求头）
// ---------------------------------------------------------------- *

export function getAccessToken(): string | null {
  if (!LIVE) return read<CustomerProfile | null>(MOCK_SESSION_KEY, null, "session") ? "mock" : null;
  return read<Tokens | null>(TOKENS_KEY, null, "local")?.access ?? null;
}

function getRefreshToken(): string | null {
  if (!LIVE) return null;
  return read<Tokens | null>(TOKENS_KEY, null, "local")?.refresh ?? null;
}

/** 同步读缓存资料：首屏先显示，随后 restoreSession 会以服务端为准校正。 */
export function getSession(): CustomerProfile | null {
  if (!LIVE) return read<CustomerProfile | null>(MOCK_SESSION_KEY, null, "session");
  return read<CustomerProfile | null>(PROFILE_KEY, null, "local");
}

function saveSession(profile: CustomerProfile, tokens: Tokens): void {
  write(TOKENS_KEY, tokens, "local");
  write(PROFILE_KEY, profile, "local");
}

function clearSession(): void {
  remove(TOKENS_KEY, "local");
  remove(PROFILE_KEY, "local");
}

// ---------------------------------------------------------------- *
// HTTP
// ---------------------------------------------------------------- *

interface Envelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.NEXT_PUBLIC_CHANNEL) {
    headers["x-publishable-key"] = process.env.NEXT_PUBLIC_CHANNEL;
  }
  const accessToken = token === undefined ? getAccessToken() : token;
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: Envelope<T> | null = null;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    throw new Error(`网络异常（HTTP ${res.status}）`);
  }
  if (!payload || payload.code !== 0) {
    throw new Error(payload?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return payload.data as T;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

async function fetchMe(accessToken?: string): Promise<CustomerProfile> {
  const me = await call<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  }>("GET", "/api/v1/store/customer/me", undefined, accessToken);
  return {
    id: me.id,
    email: me.email ?? null,
    firstName: me.first_name ?? undefined,
    lastName: me.last_name ?? undefined,
    phone: me.phone ?? undefined,
  };
}

// ---------------------------------------------------------------- *
// 认证
// ---------------------------------------------------------------- *

export type AuthResult = { ok: true; profile: CustomerProfile } | { ok: false; error: string };

/** 店铺开放的注册方式（后台「设置 → 顾客账号」决定）。 */
export type RegisterMode = "email" | "phone";

/**
 * 读店铺的注册方式。
 *
 * 读不到就按邮箱注册渲染（独立站默认），不因为后台没响应就把注册入口整个藏起来。
 */
export async function fetchAuthSettings(): Promise<{ registerMode: RegisterMode }> {
  if (!LIVE) return { registerMode: "email" };
  try {
    const res = await call<{ register_mode?: string }>("GET", "/api/v1/store/auth/settings");
    return { registerMode: res.register_mode === "phone" ? "phone" : "email" };
  } catch {
    return { registerMode: "email" };
  }
}

/**
 * 密码登录。
 *
 * identifier 可以是邮箱，也可以是手机号 —— 淘宝的登录框就是「账号/手机号」一个输入框，
 * 不要求顾客先想清楚自己当初用哪种方式注册。
 */
export async function login(identifier: string, password: string): Promise<AuthResult> {
  if (!LIVE) return mockLogin(identifier, password);
  try {
    const raw = identifier.trim();
    const tokens = await call<TokenResponse>("POST", "/api/v1/store/auth/login", {
      identifier: raw.includes("@") ? raw.toLowerCase() : raw,
      password,
    });
    // 登录响应只有 token：资料单独回读，避免前端自己编一份 email 当真相
    const profile = await fetchMe(tokens.access_token);
    saveSession(profile, { access: tokens.access_token, refresh: tokens.refresh_token });
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "登录失败" };
  }
}

export type CodeChannel = "sms" | "email";

/**
 * 邮箱注册（ADR-025）：邮箱 + 密码 + 手机号 + 验证码。
 *
 * 手机号是必填项，不是选填资料：它是这个账号的第二条登录入口
 * （手机号 + 验证码），也是国内顾客最习惯的那条。
 * 验证码可以发到邮箱，也可以发到手机，由 `channel` 决定。
 */
export async function register(input: {
  email: string;
  password: string;
  phone: string;
  channel: CodeChannel;
  code: string;
}): Promise<AuthResult> {
  if (!LIVE) return mockRegister(input);
  try {
    await call("POST", "/api/v1/store/auth/register", {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      phone: input.phone.trim(),
      channel: input.channel,
      code: input.code.trim(),
    });
    // 注册接口不签发 token：直接走一次登录，少让顾客再输一遍密码
    return login(input.email, input.password);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "注册失败" };
  }
}

/**
 * 发验证码（短信 / 邮件）。
 *
 * 开发环境后端会回传 `devCode`（AUTH_EXPOSE_DEV_CODE），前端直接显示出来，
 * 免得为了自测去翻服务器日志；生产环境这个字段不存在。
 */
export async function sendCode(input: {
  channel: CodeChannel;
  target: string;
  purpose: "login" | "register";
}): Promise<{ devCode?: string }> {
  if (!LIVE) {
    // 演示模式不真的发：固定返回 123456，页面会提示
    return { devCode: "123456" };
  }
  const res = await call<{ sent?: boolean; dev_code?: string }>(
    "POST",
    "/api/v1/store/auth/codes",
    { channel: input.channel, target: input.target.trim(), purpose: input.purpose },
  );
  return res.dev_code ? { devCode: res.dev_code } : {};
}

/**
 * 手机号 + 验证码登录（淘宝做法：注册即登录）。
 *
 * 手机号第一次用就是注册，之后就是登录 —— 顾客不需要区分「注册」和「登录」两步。
 */
export async function loginWithPhoneCode(phone: string, code: string): Promise<AuthResult> {
  if (!LIVE) {
    // 演示模式：任意 6 位码都通过，用手机号生成一个本地账号
    const normalized = phone.trim();
    const profile: CustomerProfile = {
      id: `cus_${normalized}`,
      email: null,
      phone: normalized,
      firstName: normalized.slice(-4),
    };
    write(MOCK_SESSION_KEY, profile, "session");
    return { ok: true, profile };
  }
  try {
    const tokens = await call<TokenResponse>("POST", "/api/v1/store/auth/login/phone", {
      phone: phone.trim(),
      code: code.trim(),
    });
    const profile = await fetchMe(tokens.access_token);
    saveSession(profile, { access: tokens.access_token, refresh: tokens.refresh_token });
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "登录失败" };
  }
}

/**
 * 用 refresh_token 换新的 access_token（供 SDK 的 401 自动重试调用）。
 *
 * 失败时清本地登录态：refresh 也被拒说明会话真的失效，留着只会让后续请求一直 401。
 */
export async function refreshAccessToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("登录已失效，请重新登录");
  try {
    const tokens = await call<TokenResponse>("POST", "/api/v1/store/auth/refresh", {
      refresh_token: refresh,
    });
    const profile = getSession();
    if (profile) {
      saveSession(profile, { access: tokens.access_token, refresh: tokens.refresh_token });
    } else {
      write(TOKENS_KEY, { access: tokens.access_token, refresh: tokens.refresh_token }, "local");
    }
    return tokens.access_token;
  } catch (err) {
    clearSession();
    throw err instanceof Error ? err : new Error("登录已失效，请重新登录");
  }
}

export async function logout(): Promise<void> {
  if (!LIVE) {
    remove(MOCK_SESSION_KEY, "session");
    return;
  }
  const refresh = getRefreshToken();
  clearSession();
  if (!refresh) return;
  // 撤销失败不影响本地登出：本地已清干净，服务端 token 到期自然失效
  await call("POST", "/api/v1/store/auth/logout", { refresh_token: refresh }).catch(
    () => undefined,
  );
}

/**
 * 打开页面时恢复登录态。
 *
 * 本地缓存先当「可能的身份」，再向服务端确认一次：
 * token 过期会自动 refresh，refresh 也失效则清空并返回 null。
 */
export async function restoreSession(): Promise<CustomerProfile | null> {
  if (!LIVE) return getSession();
  if (!getAccessToken()) return null;
  try {
    const profile = await fetchMe();
    write(PROFILE_KEY, profile, "local");
    return profile;
  } catch {
    try {
      const token = await refreshAccessToken();
      const profile = await fetchMe(token);
      const latest = getRefreshToken();
      if (latest) saveSession(profile, { access: token, refresh: latest });
      return profile;
    } catch {
      clearSession();
      return null;
    }
  }
}

// ---------------------------------------------------------------- *
// 地址簿
// ---------------------------------------------------------------- *

interface MockUser {
  password: string;
  profile: CustomerProfile;
}

const DEMO_USER: MockUser = {
  password: "demo1234",
  profile: { id: "cus_demo", email: "demo@example.com", phone: "13800001234", firstName: "演示用户" },
};

function mockUsers(): Record<string, MockUser> {
  const users = read<Record<string, MockUser>>(MOCK_USERS_KEY, {}, "session");
  if (Object.keys(users).length > 0) return users;
  const seeded = { [DEMO_USER.profile.email ?? "demo@example.com"]: DEMO_USER };
  write(MOCK_USERS_KEY, seeded, "session");
  return seeded;
}

function mockLogin(email: string, password: string): AuthResult {
  const key = email.trim().toLowerCase();
  const user = mockUsers()[key];
  if (!user || user.password !== password) return { ok: false, error: "邮箱或密码不正确" };
  write(MOCK_SESSION_KEY, user.profile, "session");
  return { ok: true, profile: user.profile };
}

function mockRegister(input: { email: string; password: string; phone?: string }): AuthResult {
  const key = input.email.trim().toLowerCase();
  const users = mockUsers();
  if (users[key]) return { ok: false, error: "该邮箱已注册，可直接登录" };
  const profile: CustomerProfile = {
    id: `cus_${Date.now().toString(36)}`,
    email: key,
    phone: input.phone,
    firstName: key.split("@")[0],
  };
  users[key] = { password: input.password, profile };
  write(MOCK_USERS_KEY, users, "session");
  write(MOCK_SESSION_KEY, profile, "session");
  return { ok: true, profile };
}

/**
 * 地址簿：暂时只有本地实现。
 *
 * 后端 `/store/customer/addresses` 已就绪，但表单字段（收件人拆姓/名、邮编、国家）
 * 尚未改造。半接的状态更难查：地址能存但下单带不出来，不如先明确留在这里。
 */
export function listAddresses(): AddressRecord[] {
  return read<AddressRecord[]>(MOCK_ADDRESS_KEY, [], "session");
}

export function saveAddress(input: AddressInput, id?: string): void {
  const list = listAddresses();
  if (id) {
    const idx = list.findIndex((a) => a.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, name: input.name, phone: input.phone, region: input.region, line1: input.line1 };
    }
  } else {
    list.push({
      id: `addr_${Date.now().toString(36)}`,
      name: input.name,
      phone: input.phone,
      region: input.region,
      line1: input.line1,
      isDefault: input.isDefault ?? list.length === 0,
    });
  }
  if (input.isDefault) {
    const targetId = id ?? list[list.length - 1]!.id;
    for (const a of list) a.isDefault = a.id === targetId;
  }
  write(MOCK_ADDRESS_KEY, list, "session");
}

export function deleteAddress(id: string): void {
  const list = listAddresses();
  const wasDefault = list.find((a) => a.id === id)?.isDefault;
  const next = list.filter((a) => a.id !== id);
  if (wasDefault && next.length > 0) next[0]!.isDefault = true;
  write(MOCK_ADDRESS_KEY, next, "session");
}

export function setDefaultAddress(id: string): void {
  const list = listAddresses();
  for (const a of list) a.isDefault = a.id === id;
  write(MOCK_ADDRESS_KEY, list, "session");
}
