/**
 * 金额展示（仅前端展示，不参与任何计算）。
 * -----------------------------------------------------------------------------
 * 后端以 amount_minor（bigint）全链路传递，业务换算在 core/money（ISO 4217 指数表）。
 * 这里只用 Intl.NumberFormat 把最小单位转成可读字符串，禁止在 UI 里做加减乘除。
 */

/** 货币指数表（最小单位 → 主单位）。缺省按 2 处理。 */
const CURRENCY_EXPONENT: Record<string, number> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
};

export type MinorAmount = number | string | bigint;

export function currencyExponent(currencyCode: string): number {
  return CURRENCY_EXPONENT[currencyCode] ?? 2;
}

/** 最小单位 → 主单位数值（仅供格式化中间值，不做结算运算）。 */
export function minorToMajor(amountMinor: MinorAmount, currencyCode = 'CNY'): number {
  const divisor = 10 ** currencyExponent(currencyCode);
  return Number(amountMinor) / divisor;
}

/** 格式化金额为带货币符号字符串，如 ¥199.00 / $19.99。 */
export function formatMoney(
  amountMinor: MinorAmount,
  currencyCode = 'CNY',
  locale = 'zh-CN',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'narrowSymbol',
  }).format(minorToMajor(amountMinor, currencyCode));
}
