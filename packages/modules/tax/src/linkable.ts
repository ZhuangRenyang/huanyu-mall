import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "tax_rate", fields: ["id", "name", "rate_bps", "is_inclusive"] },
];
