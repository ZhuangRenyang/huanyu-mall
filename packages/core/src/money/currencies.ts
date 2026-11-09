import { DomainError } from "../errors/index.js";

/** ISO 4217 最小单位指数（= 小数位数）。 */
const CURRENCY_EXPONENTS: Record<string, number> = {
  CNY: 2, USD: 2, EUR: 2, JPY: 0, GBP: 2, HKD: 2, TWD: 2,
  KRW: 0, SGD: 2, AUD: 2, CAD: 2, CHF: 2, NZD: 2, SEK: 2,
  NOK: 2, DKK: 2, THB: 2, MYR: 2, IDR: 2, PHP: 2, VND: 0,
  INR: 2, RUB: 2, BRL: 2, MXN: 2, ZAR: 2, TRY: 2, AED: 2,
  SAR: 2, PLN: 2, CZK: 2, HUF: 2, RON: 2, BGN: 2, CLP: 0,
  COP: 2, PEN: 2, ARS: 2, EGP: 2, NGN: 2, KES: 2, MAD: 2,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3,
};

export function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isSupportedCurrency(code: string): boolean {
  return CURRENCY_EXPONENTS[normalizeCurrencyCode(code)] !== undefined;
}

/** 返回币种的小数位数；不支持的币种抛 DomainError(20004)。 */
export function getCurrencyExponent(code: string): number {
  const normalized = normalizeCurrencyCode(code);
  const exponent = CURRENCY_EXPONENTS[normalized];
  if (exponent === undefined) {
    throw new DomainError({ code: 20004, message: `Unsupported currency: ${code}` });
  }
  return exponent;
}
