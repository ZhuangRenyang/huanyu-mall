/**
 * 运费数据层（ADR-019 / ADR-021）。
 *
 * 模型照抄淘宝 / Shopify / WooCommerce：
 *   商品上架时选**运费模板**（或标「卖家包邮」）
 *   模板里是 **发货区（按国家）→ 区内运费方式（固定价 / 满额包邮）**
 *
 * 所以商品详情只选模板，不填金额；模板管理在「商品 → 运费模板」。
 *
 * 金额：界面用「元」输入，落库一律 minor unit（分），换算只在这一层做。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export interface ShippingOptionView {
  id: string;
  zoneId: string;
  name: string;
  carrier: string | null;
  type: 'flat' | 'free_over';
  amountMinor: number;
  currencyCode: string;
  isActive: boolean;
  freeOverThresholdMinor: number | null;
}

export interface ShippingProfileView {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface ShippingZoneView {
  id: string;
  name: string;
  profileId: string | null;
  countryCodes: string[];
  options: ShippingOptionView[];
}

export interface ShippingCountryView {
  code: string;
  name: string;
}

export interface ShippingConfigView {
  profiles: ShippingProfileView[];
  zones: ShippingZoneView[];
  countries: ShippingCountryView[];
  currencyCode: string;
}

/** 元 → 分。用 round 兜住 0.1+0.2 这类浮点误差，不能直接 ×100 取整。 */
export function yuanToMinor(input: string): number {
  const value = Number(input.trim());
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

/** 分 → 元（展示用，去掉多余的 .00）。 */
export function minorToYuan(minor: number): string {
  return (minor / 100).toFixed(2).replace(/\.00$/, '');
}

// ------------------------------------------------------------------ *
// mock 模式：localStorage（零依赖演示）
// ------------------------------------------------------------------ *

const KEY = 'admin:shipping-config';
const MOCK_COUNTRIES: ShippingCountryView[] = [
  { code: 'CN', name: '中国' },
  { code: 'HK', name: '中国香港' },
  { code: 'US', name: '美国' },
  { code: 'JP', name: '日本' },
  { code: 'SG', name: '新加坡' },
];

/** 演示数据：一个区、两个方式。真实环境（live）读后端，不带任何默认值。 */
function seedMock(): ShippingConfigView {
  return {
    profiles: [{ id: 'shprof_default', name: '默认运费模板', isDefault: true }],
    zones: [
      {
        id: 'zone_demo',
        name: '中国大陆',
        profileId: 'shprof_default',
        countryCodes: ['CN'],
        options: [
          {
            id: 'shipopt_demo_std',
            zoneId: 'zone_demo',
            name: '标准快递',
            carrier: '顺丰',
            type: 'flat',
            amountMinor: 800,
            currencyCode: 'CNY',
            isActive: true,
            freeOverThresholdMinor: null,
          },
          {
            id: 'shipopt_demo_free',
            zoneId: 'zone_demo',
            name: '满额包邮',
            carrier: null,
            type: 'free_over',
            amountMinor: 800,
            currencyCode: 'CNY',
            isActive: true,
            freeOverThresholdMinor: 9900,
          },
        ],
      },
    ],
    countries: MOCK_COUNTRIES,
    currencyCode: 'CNY',
  };
}

function readMock(): ShippingConfigView {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ShippingConfigView;
  } catch {
    // 隐私模式 / 脏数据
  }
  return seedMock();
}

function writeMock(config: ShippingConfigView): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // 隐私模式
  }
}

let mockSeq = 0;
function mockId(prefix: string): string {
  mockSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${mockSeq}`;
}

// ------------------------------------------------------------------ *
// 公开 API
// ------------------------------------------------------------------ *

export async function getShippingConfig(): Promise<ShippingConfigView> {
  if (getAdminApiMode() !== 'live') return readMock();
  const raw = (await adminClient().getShippingConfig()) as {
    profiles?: Array<Record<string, unknown>>;
    zones?: Array<Record<string, unknown>>;
    countries?: Array<Record<string, unknown>>;
    currency_code?: string;
  };
  return {
    profiles: (raw.profiles ?? []).map((p) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      isDefault: p.is_default === true,
    })),
    zones: (raw.zones ?? []).map((z) => ({
      id: String(z.id ?? ''),
      name: String(z.name ?? ''),
      profileId: (z.profile_id as string | null) ?? null,
      countryCodes: Array.isArray(z.country_codes) ? (z.country_codes as string[]) : [],
      options: ((z.options ?? []) as Array<Record<string, unknown>>).map((o) => ({
        id: String(o.id ?? ''),
        zoneId: String(o.zone_id ?? z.id ?? ''),
        name: String(o.name ?? ''),
        carrier: (o.carrier as string | null) ?? null,
        type: o.type === 'free_over' ? 'free_over' : 'flat',
        amountMinor: Number(o.amount_minor ?? 0),
        currencyCode: String(o.currency_code ?? raw.currency_code ?? 'CNY'),
        isActive: o.is_active !== false,
        freeOverThresholdMinor:
          o.free_over_threshold_minor == null ? null : Number(o.free_over_threshold_minor),
      })),
    })),
    countries: (raw.countries ?? []).map((c) => ({
      code: String(c.code ?? ''),
      name: String(c.name ?? c.code ?? ''),
    })),
    currencyCode: String(raw.currency_code ?? 'CNY'),
  };
}

export async function createZone(
  name: string,
  countryCodes: string[],
  profileId: string | null,
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.zones.push({ id: mockId('zone'), name, profileId, countryCodes, options: [] });
    writeMock(config);
    return;
  }
  await adminClient().createShippingZone({ name, country_codes: countryCodes, profile_id: profileId });
}

// ---- 运费模板 ----

export async function createProfile(name: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.profiles.push({ id: mockId('shprof'), name, isDefault: false });
    writeMock(config);
    return;
  }
  await adminClient().createShippingProfile({ name });
}

export async function updateProfile(id: string, name: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    const p = config.profiles.find((x) => x.id === id);
    if (p) p.name = name;
    writeMock(config);
    return;
  }
  await adminClient().updateShippingProfile(id, { name });
}

export async function deleteProfile(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.profiles = config.profiles.filter((p) => p.id !== id);
    config.zones = config.zones.filter((z) => z.profileId !== id);
    writeMock(config);
    return;
  }
  await adminClient().deleteShippingProfile(id);
}

export async function updateZone(
  id: string,
  patch: { name?: string; countryCodes?: string[] },
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    const zone = config.zones.find((z) => z.id === id);
    if (zone) {
      if (patch.name !== undefined) zone.name = patch.name;
      if (patch.countryCodes !== undefined) zone.countryCodes = patch.countryCodes;
    }
    writeMock(config);
    return;
  }
  await adminClient().updateShippingZone(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.countryCodes !== undefined ? { country_codes: patch.countryCodes } : {}),
  });
}

export async function deleteZone(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.zones = config.zones.filter((z) => z.id !== id);
    writeMock(config);
    return;
  }
  await adminClient().deleteShippingZone(id);
}

export async function createOption(input: {
  zoneId: string;
  name: string;
  carrier: string | null;
  type: 'flat' | 'free_over';
  amountMinor: number;
  freeOverThresholdMinor: number | null;
}): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    const zone = config.zones.find((z) => z.id === input.zoneId);
    if (!zone) return;
    zone.options.push({
      id: mockId('shipopt'),
      zoneId: input.zoneId,
      name: input.name,
      carrier: input.carrier,
      type: input.type,
      amountMinor: input.amountMinor,
      currencyCode: config.currencyCode,
      isActive: true,
      freeOverThresholdMinor: input.type === 'free_over' ? input.freeOverThresholdMinor : null,
    });
    writeMock(config);
    return;
  }
  await adminClient().createShippingOption({
    zone_id: input.zoneId,
    name: input.name,
    carrier: input.carrier,
    type: input.type,
    amount_minor: input.amountMinor,
    free_over_threshold_minor:
      input.type === 'free_over' ? input.freeOverThresholdMinor : null,
  });
}

export async function updateOption(
  id: string,
  patch: {
    name?: string;
    carrier?: string | null;
    type?: 'flat' | 'free_over';
    amountMinor?: number;
    freeOverThresholdMinor?: number | null;
    isActive?: boolean;
  },
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    for (const zone of config.zones) {
      const option = zone.options.find((o) => o.id === id);
      if (!option) continue;
      if (patch.name !== undefined) option.name = patch.name;
      if (patch.carrier !== undefined) option.carrier = patch.carrier;
      if (patch.type !== undefined) option.type = patch.type;
      if (patch.amountMinor !== undefined) option.amountMinor = patch.amountMinor;
      if (patch.isActive !== undefined) option.isActive = patch.isActive;
      if (patch.type === 'flat') option.freeOverThresholdMinor = null;
      else if (patch.freeOverThresholdMinor !== undefined) {
        option.freeOverThresholdMinor = patch.freeOverThresholdMinor;
      }
    }
    writeMock(config);
    return;
  }
  await adminClient().updateShippingOption(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.carrier !== undefined ? { carrier: patch.carrier } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.amountMinor !== undefined ? { amount_minor: patch.amountMinor } : {}),
    ...(patch.freeOverThresholdMinor !== undefined
      ? { free_over_threshold_minor: patch.freeOverThresholdMinor }
      : {}),
    ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
  });
}

export async function deleteOption(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    for (const zone of config.zones) {
      zone.options = zone.options.filter((o) => o.id !== id);
    }
    writeMock(config);
    return;
  }
  await adminClient().deleteShippingOption(id);
}
