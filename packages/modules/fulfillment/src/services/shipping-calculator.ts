import type { PriceRuleDTO, ShippingOptionDTO, ShippingPriceContext } from "../types.js";

/**
 * 纯函数：运费计算三档。
 * - flat：固定运费 = option.amountMinor
 * - free_over：购物车小计 ≥ 门槛 → 0，否则 option.amountMinor
 * - weight_based：命中重量区间 → 对应 rule.amountMinor，否则 option.amountMinor
 */
export function calculateShipping(
  option: ShippingOptionDTO,
  rules: PriceRuleDTO[],
  ctx: ShippingPriceContext,
): bigint {
  if (option.type === "free_over") {
    const rule = rules.find((r) => r.rule_type === "free_over");
    const threshold = rule?.order_over_minor ?? 0n;
    if (ctx.cartSubtotalMinor >= threshold && threshold > 0n) return 0n;
    return option.amount_minor;
  }

  if (option.type === "weight_based") {
    const weight = ctx.weightGram ?? 0;
    const band = rules.find(
      (r) =>
        r.rule_type === "weight_based" &&
        (r.weight_min_g ?? 0) <= weight &&
        (r.weight_max_g ?? Number.MAX_SAFE_INTEGER) >= weight,
    );
    return band ? band.amount_minor : option.amount_minor;
  }

  return option.amount_minor;
}
