import type { PriceDTO } from "../types.js";

/**
 * 纯函数：按币种 + 数量档位选价（同一 price_set 内）。
 * 规则：币种匹配 + min_quantity <= quantity，取 min_quantity 最高的档位（阶梯价）。
 * 一期不做价格表规则匹配与汇率换算。
 */
export function selectPrice(
  prices: PriceDTO[],
  ctx: { currencyCode: string; quantity: number },
): PriceDTO | null {
  const candidates = prices.filter(
    (p) =>
      p.currency_code === ctx.currencyCode &&
      p.min_quantity <= ctx.quantity &&
      (p.max_quantity === null || ctx.quantity <= p.max_quantity),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) => (p.min_quantity > best.min_quantity ? p : best));
}
