/**
 * 店面可选国家/地区（ADR-018 补充：订单页要能「选」，不能只有中国一条）。
 *
 * 为什么需要这份清单：
 * 之前店面 `COUNTRIES = [{ code: 'CN', name: '中国' }]` 写死，顾客「选国家」其实只有
 * 一个选项——后台配了别国税率也选不到，所谓「按用户选择」根本无从发生。
 *
 * 规则：**内置常用清单 ∪ 商家配过税率的国家**，去重后按中文名排序。
 * - 内置清单保证新装商城开箱能卖（税率走默认税率）；
 * - 商家配了冷门国家（如 KZ）也会自动出现，不用改代码。
 *
 * 这里只管「有哪些可选、叫什么、会收多少税」，不负责运费可用性——
 * 没配运费区域的国家，结账时会因无配送方式被拦住，这是正确行为。
 */
import type { CheckoutCountryDTO, TaxRateRuleDTO } from "../types.js";

/** 内置常用国家/地区（代码 → 中文名）。促销/税务都按两位大写码匹配。 */
export const BASE_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "CN", name: "中国" },
  { code: "HK", name: "中国香港" },
  { code: "MO", name: "中国澳门" },
  { code: "TW", name: "中国台湾" },
  { code: "JP", name: "日本" },
  { code: "KR", name: "韩国" },
  { code: "SG", name: "新加坡" },
  { code: "MY", name: "马来西亚" },
  { code: "TH", name: "泰国" },
  { code: "VN", name: "越南" },
  { code: "ID", name: "印度尼西亚" },
  { code: "PH", name: "菲律宾" },
  { code: "IN", name: "印度" },
  { code: "AE", name: "阿联酋" },
  { code: "AU", name: "澳大利亚" },
  { code: "NZ", name: "新西兰" },
  { code: "US", name: "美国" },
  { code: "CA", name: "加拿大" },
  { code: "GB", name: "英国" },
  { code: "DE", name: "德国" },
  { code: "FR", name: "法国" },
  { code: "IT", name: "意大利" },
  { code: "ES", name: "西班牙" },
  { code: "NL", name: "荷兰" },
  { code: "BR", name: "巴西" },
  { code: "MX", name: "墨西哥" },
];

/**
 * 合并清单。
 *
 * @param rates     商家配置的税率（含 country_code = null 的默认税率）
 * @param enabled   税务总开关；关着时所有国家都报 0（不然界面会写出「收 13%」却并不收）
 * @param fallbackDefault 默认税率（bps），用于给没配国家的条目算展示税率
 */
export function buildCheckoutCountries(
  rates: TaxRateRuleDTO[],
  enabled: boolean,
  fallbackDefault: number,
): CheckoutCountryDTO[] {
  const byCountry = new Map<string, number>();
  for (const r of rates) {
    if (r.country_code) byCountry.set(r.country_code, r.rate_bps);
  }
  const hasDefault = rates.some((r) => r.country_code === null);
  const defaultBps = hasDefault ? fallbackDefault : 0;

  const merged = new Map<string, CheckoutCountryDTO>();
  for (const c of BASE_COUNTRIES) {
    const own = byCountry.get(c.code);
    merged.set(c.code, {
      code: c.code,
      name: c.name,
      tax_rate_bps: enabled ? (own ?? defaultBps) : 0,
      rate_source: !enabled ? "none" : own !== undefined ? "country" : defaultBps > 0 ? "default" : "none",
    });
  }
  // 商家配了内置清单里没有的国家：也要能选，名字先用代码（后台可改税率备注）
  for (const [code, bps] of byCountry) {
    if (merged.has(code)) continue;
    merged.set(code, {
      code,
      name: code,
      tax_rate_bps: enabled ? bps : 0,
      rate_source: enabled ? "country" : "none",
    });
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}
