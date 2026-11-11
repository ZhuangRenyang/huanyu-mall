/**
 * 税务配置数据层（ADR-018）。
 *
 * 用户要求：没有固定税区，税率看顾客选的国家，后台可切换可调整。
 * 所以这里三样东西：总开关 + 默认税率 + 国家→税率覆盖表。
 * snake_case ↔ camelCase 只在这一层换；税率用万分比（1300 = 13%）。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export interface TaxSettingsView {
  enabled: boolean;
  taxName: string;
  pricesIncludeTax: boolean;
}

export interface TaxRateView {
  id: string;
  name: string;
  /** 万分比：1300 = 13%。 */
  rateBps: number;
  /** ISO 国家码（大写）；null = 默认税率。 */
  countryCode: string | null;
}

export interface TaxConfigView {
  settings: TaxSettingsView;
  defaultRate: TaxRateView | null;
  countryRates: TaxRateView[];
}

export const TAX_DEFAULT_SETTINGS: TaxSettingsView = {
  enabled: false,
  taxName: '税',
  pricesIncludeTax: true,
};

// ------------------------------------------------------------------ *
// mock 模式：localStorage，演示「可切换调整」
// ------------------------------------------------------------------ *
const KEY = 'admin:tax-config';

function readMock(): TaxConfigView {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as TaxConfigView;
  } catch {
    // 忽略
  }
  return { settings: { ...TAX_DEFAULT_SETTINGS }, defaultRate: null, countryRates: [] };
}

function writeMock(config: TaxConfigView): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // 隐私模式
  }
}

/** 百分比 → 万分比（13 → 1300）。 */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/** 万分比 → 百分比（1300 → 13），展示用。 */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

// ------------------------------------------------------------------ *
// 公开 API
// ------------------------------------------------------------------ *
export async function getTaxConfig(): Promise<TaxConfigView> {
  if (getAdminApiMode() !== 'live') return readMock();
  const raw = (await adminClient().getTaxConfig()) as {
    settings?: Record<string, unknown>;
    default_rate?: Record<string, unknown> | null;
    country_rates?: Array<Record<string, unknown>>;
  };
  const rate = (r: Record<string, unknown> | null | undefined, countryCode: string | null): TaxRateView | null =>
    r
      ? {
          id: String(r.id ?? ''),
          name: String(r.name ?? ''),
          rateBps: Number(r.rate_bps ?? 0),
          countryCode,
        }
      : null;
  return {
    settings: {
      enabled: Boolean(raw.settings?.enabled),
      taxName: String(raw.settings?.tax_name ?? '税'),
      pricesIncludeTax: raw.settings?.prices_include_tax !== false,
    },
    defaultRate: rate(raw.default_rate ?? null, null),
    countryRates: (raw.country_rates ?? [])
      .map((r) => rate(r, String(r.country_code ?? '')))
      .filter((r): r is TaxRateView => r !== null),
  };
}

export async function updateTaxSettings(patch: Partial<TaxSettingsView>): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.settings = { ...config.settings, ...patch };
    writeMock(config);
    return;
  }
  const body: Record<string, unknown> = {};
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.taxName !== undefined) body.tax_name = patch.taxName;
  if (patch.pricesIncludeTax !== undefined) body.prices_include_tax = patch.pricesIncludeTax;
  await adminClient().updateTaxSettings(body);
}

export async function setDefaultRate(name: string, rateBps: number): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.defaultRate = { id: 'tax_default', name, rateBps, countryCode: null };
    writeMock(config);
    return;
  }
  await adminClient().setDefaultTaxRate({ name, rate_bps: rateBps });
}

export async function setCountryRate(countryCode: string, name: string, rateBps: number): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    const idx = config.countryRates.findIndex((r) => r.countryCode === countryCode);
    const row: TaxRateView = { id: `tax_${countryCode}`, name, rateBps, countryCode };
    if (idx >= 0) config.countryRates[idx] = row;
    else config.countryRates.push(row);
    writeMock(config);
    return;
  }
  await adminClient().setCountryTaxRate(countryCode, { name, rate_bps: rateBps });
}

export async function deleteCountryRate(countryCode: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const config = readMock();
    config.countryRates = config.countryRates.filter((r) => r.countryCode !== countryCode);
    writeMock(config);
    return;
  }
  await adminClient().deleteCountryTaxRate(countryCode);
}
