/**
 * 金额格式化：整数最小单位 → 货币显示。
 * 用 BigInt 做整除与取余，不用 `minor / 100`——浮点会在大额上产生 0.01 误差，
 * 这是「金额只用整数」这条纪律在展示层的延续。
 */
export function formatMinor(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = BigInt(Math.abs(Math.trunc(minor)));
  const scale = 10n ** BigInt(digits);
  const whole = abs / scale;
  const frac = abs % scale;
  const wholeStr = groupThousands(whole.toString());
  const body = digits > 0 ? `${wholeStr}.${frac.toString().padStart(digits, "0")}` : wholeStr;
  return `${sign}${currencySymbol(currency)}${body}`;
}

function currencyDigits(currency: string): number {
  // 零小数币种：JPY / KRW / VND 等
  if (/^(JPY|KRW|VND|CLP|ISK|HUF|TWD)$/i.test(currency)) return 0;
  return 2;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "CNY":
    case "RMB":
      return "¥";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "JPY":
      return "¥";
    case "HKD":
      return "HK$";
    case "SGD":
      return "S$";
    default:
      return `${currency.toUpperCase()} `;
  }
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
