import type { LinkableDefinition } from "@mall/core";

/** promotion 模块暂不对外暴露 links join（折扣通过 computeDiscounts 契约消费，见 ADR-012 §4）。 */
export const linkable: LinkableDefinition[] = [];
