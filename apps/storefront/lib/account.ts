/**
 * 账户数据层（mock）：注册/登录/登出 + 地址簿，全部走 sessionStorage。
 * 真实接入后替换为 /store/auth/* 与 /store/customer/addresses。
 */

export interface CustomerProfile {
  id: string;
  email: string;
  phone?: string;
  firstName?: string;
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

const USERS_KEY = 'account:users';
const SESSION_KEY = 'account:session';
const ADDRESS_KEY = 'account:addresses';

interface StoredUser {
  password: string;
  profile: CustomerProfile;
}

const DEMO_USER: StoredUser = {
  password: 'demo1234',
  profile: { id: 'cus_demo', email: 'demo@example.com', phone: '13800001234', firstName: '演示用户' },
};

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* noop */
  }
}

function readUsers(): Record<string, StoredUser> {
  const users = safeGet<Record<string, StoredUser>>(USERS_KEY, {});
  if (Object.keys(users).length === 0) {
    const seeded = { [DEMO_USER.profile.email]: DEMO_USER };
    safeSet(USERS_KEY, seeded);
    return seeded;
  }
  return users;
}

export function getSession(): CustomerProfile | null {
  return safeGet<CustomerProfile | null>(SESSION_KEY, null);
}

export type AuthResult = { ok: true; profile: CustomerProfile } | { ok: false; error: string };

export function register(input: { email: string; password: string; phone?: string }): AuthResult {
  const email = input.email.trim().toLowerCase();
  const users = readUsers();
  if (users[email]) return { ok: false, error: '该邮箱已注册，可直接登录' };
  const profile: CustomerProfile = {
    id: `cus_${Date.now().toString(36)}`,
    email,
    phone: input.phone?.trim() || undefined,
    firstName: email.split('@')[0],
  };
  users[email] = { password: input.password, profile };
  safeSet(USERS_KEY, users);
  safeSet(SESSION_KEY, profile);
  return { ok: true, profile };
}

export function login(email: string, password: string): AuthResult {
  const key = email.trim().toLowerCase();
  const user = readUsers()[key];
  if (!user || user.password !== password) return { ok: false, error: '邮箱或密码不正确' };
  safeSet(SESSION_KEY, user.profile);
  return { ok: true, profile: user.profile };
}

export function logout(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

export function listAddresses(): AddressRecord[] {
  return safeGet<AddressRecord[]>(ADDRESS_KEY, []);
}

export function saveAddress(input: AddressInput, id?: string): void {
  const list = listAddresses();
  if (id) {
    const idx = list.findIndex((a) => a.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], name: input.name, phone: input.phone, region: input.region, line1: input.line1 };
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
    const targetId = id ?? list[list.length - 1].id;
    for (const a of list) a.isDefault = a.id === targetId;
  }
  safeSet(ADDRESS_KEY, list);
}

export function deleteAddress(id: string): void {
  const list = listAddresses();
  const wasDefault = list.find((a) => a.id === id)?.isDefault;
  const next = list.filter((a) => a.id !== id);
  if (wasDefault && next.length > 0) next[0].isDefault = true;
  safeSet(ADDRESS_KEY, next);
}

export function setDefaultAddress(id: string): void {
  const list = listAddresses();
  for (const a of list) a.isDefault = a.id === id;
  safeSet(ADDRESS_KEY, list);
}
