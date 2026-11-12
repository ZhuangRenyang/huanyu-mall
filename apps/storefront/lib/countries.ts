/**
 * 结账可选国家（ADR-018 / ADR-019）。
 *
 * 清单以后端为准：**以运费可配送范围为准**，每个国家附带实际生效税率。
 *
 * 这里要区分两种「空」：
 * - 接口失败 / 网络断：退回最小清单（只中国），保证结账页还能用；
 * - 后端明确返回空：商家还没配配送范围 → **绝不能兜底成中国**。
 *   否则顾客能选一个没有运费方案的国家，填完地址点下单才失败。
 */
import type { CheckoutCountry } from '@mall/sdk';
import { getStoreClient } from './api';

/** 接口不可用时的兜底清单：至少能按主市场下单。 */
export const FALLBACK_COUNTRIES: CheckoutCountry[] = [
  { code: 'CN', name: '中国', tax_rate_bps: 0, rate_source: 'none' },
];

export interface CheckoutCountries {
  items: CheckoutCountry[];
  /**
   * 配送范围是否已配置：
   * - 'ok'   有可配送国家
   * - 'none' 商家一个区都没配（界面要挡住下单并提示，而不是显示空下拉）
   * - 'unknown' 接口不可用，按兜底清单走
   */
  status: 'ok' | 'none' | 'unknown';
}

export async function loadCheckoutCountries(): Promise<CheckoutCountries> {
  try {
    const res = (await getStoreClient().getCheckoutCountries()) as {
      items?: CheckoutCountry[];
      shipping_configured?: boolean;
    };
    const items = res.items ?? [];
    if (items.length === 0) {
      // 后端明确说没配 → 不兜底
      return { items: [], status: res.shipping_configured === true ? 'ok' : 'none' };
    }
    return { items, status: 'ok' };
  } catch {
    return { items: FALLBACK_COUNTRIES, status: 'unknown' };
  }
}

/**
 * 时区 → 国家码（只覆盖常见时区，猜错也不影响正确性：顾客在地址步会看到并核对）。
 *
 * 为什么用时区而不是 IP 定位：IP 定位要么需要外部服务（多一个依赖与隐私问题），
 * 要么需要后端拿代理头（不可靠）；时区浏览器本地就能拿到，够用来「预填」。
 */
const TIMEZONE_COUNTRY: Record<string, string> = {
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Urumqi': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Macau': 'MO',
  'Asia/Taipei': 'TW',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Kolkata': 'IN',
  'Asia/Dubai': 'AE',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'Europe/Amsterdam': 'NL',
};

/**
 * 猜一个「可能的国家」。返回 null 表示猜不到（就按默认中国走）。
 * 只是预填建议——真正的口径是顾客在地址步确认的国家。
 */
export function guessCountry(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TIMEZONE_COUNTRY[tz]) return TIMEZONE_COUNTRY[tz]!;
    // 语言标签兜底：zh-HK / ja-JP / en-US 的地区段
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || navigator.language;
    const region = locale.split('-')[1]?.toUpperCase();
    if (region && /^[A-Z]{2}$/.test(region)) return region;
  } catch {
    /* SSR 或环境不支持 Intl 时直接返回 null */
  }
  return null;
}

/** 选项文案：税率 > 0 时标出来，顾客切换国家能预期价格变化。 */
export function countryLabel(c: CheckoutCountry): string {
  if (c.tax_rate_bps <= 0) return c.name;
  return `${c.name}（税率 ${c.tax_rate_bps / 100}%）`;
}
