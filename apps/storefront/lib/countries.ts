/**
 * 结账可选国家（ADR-018）。
 *
 * 清单以后端为准：内置常用 ∪ 商家配过税率的国家，每个带实际生效税率。
 * 拿不到时退回最小清单（只中国），保证结账页永远能用——不能因为一个
 * 附加接口失败就让顾客下不了单。
 */
import type { CheckoutCountry } from '@mall/sdk';
import { getStoreClient } from './api';

/** 兜底清单：后端不可用时至少能按主市场下单。 */
export const FALLBACK_COUNTRIES: CheckoutCountry[] = [
  { code: 'CN', name: '中国', tax_rate_bps: 0, rate_source: 'none' },
];

export async function loadCheckoutCountries(): Promise<CheckoutCountry[]> {
  try {
    const res = (await getStoreClient().getCheckoutCountries()) as {
      items?: CheckoutCountry[];
    };
    const items = res.items ?? [];
    return items.length > 0 ? items : FALLBACK_COUNTRIES;
  } catch {
    return FALLBACK_COUNTRIES;
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
