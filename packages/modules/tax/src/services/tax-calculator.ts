/** 纯函数：按 rate_bps 计算税额（bigint 整数运算，禁浮点，四舍五入）。 */
export function taxFor(amountMinor: bigint, rateBps: number, inclusive: boolean): bigint {
  if (rateBps <= 0 || amountMinor <= 0n) return 0n;
  const rate = BigInt(rateBps);
  if (inclusive) {
    // 含税价拆税：tax = amount * rate / (10000 + rate)
    return roundDiv(amountMinor * rate, 10000n + rate);
  }
  // 价外加税：tax = amount * rate / 10000
  return roundDiv(amountMinor * rate, 10000n);
}

/** 正数四舍五入（half up）。 */
function roundDiv(numerator: bigint, divisor: bigint): bigint {
  return (numerator + divisor / 2n) / divisor;
}
