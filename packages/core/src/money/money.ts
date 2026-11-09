import { DomainError } from "../errors/index.js";
import { getCurrencyExponent, normalizeCurrencyCode } from "./currencies.js";

export type AmountMinor = bigint;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * 十进制金额字符串 → 最小单位 bigint。
 * 全程整数运算，禁浮点；多余小数位四舍五入（round half away from zero）。
 */
export function toMinor(amount: string, currencyCode: string): bigint {
  const exponent = getCurrencyExponent(currencyCode);
  const value = amount.trim();
  if (!DECIMAL_RE.test(value)) {
    throw new DomainError({ code: 20001, message: `Invalid amount: ${amount}` });
  }

  const negative = value.startsWith("-");
  const abs = negative ? value.slice(1) : value;
  const [intPart = "0", fracPart = ""] = abs.split(".");
  const base = 10n ** BigInt(exponent);

  let minor = BigInt(intPart || "0") * base;
  if (fracPart.length > 0) {
    const kept = fracPart.slice(0, exponent).padEnd(exponent, "0");
    minor += kept ? BigInt(kept) : 0n;
    if (fracPart.length > exponent) {
      const firstDropped = Number(fracPart[exponent]);
      if (firstDropped >= 5) minor += 1n;
    }
  }
  return negative ? -minor : minor;
}

/** 最小单位 bigint → 十进制字符串。 */
export function fromMinor(minor: bigint, currencyCode: string): string {
  const exponent = getCurrencyExponent(currencyCode);
  if (exponent === 0) return minor.toString();

  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const base = 10n ** BigInt(exponent);
  const intPart = abs / base;
  const fracPart = (abs % base).toString().padStart(exponent, "0");
  return `${negative ? "-" : ""}${intPart.toString()}.${fracPart}`;
}

/** 断言两个币种一致，否则抛 DomainError(20004)。 */
export function assertSameCurrency(a: string, b: string): void {
  if (normalizeCurrencyCode(a) !== normalizeCurrencyCode(b)) {
    throw new DomainError({ code: 20004, message: `Currency mismatch: ${a} vs ${b}` });
  }
}
