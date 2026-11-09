import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "shipping_option", fields: ["id", "name", "zone_id", "type", "amount_minor", "currency_code", "is_active"] },
];
