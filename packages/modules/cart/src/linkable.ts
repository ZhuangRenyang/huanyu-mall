import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "cart", fields: ["id", "channel_id", "currency_code", "customer_id", "status"] },
];
