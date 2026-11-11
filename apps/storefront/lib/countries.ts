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

/** 选项文案：税率 > 0 时标出来，顾客切换国家能预期价格变化。 */
export function countryLabel(c: CheckoutCountry): string {
  if (c.tax_rate_bps <= 0) return c.name;
  return `${c.name}（税率 ${c.tax_rate_bps / 100}%）`;
}
