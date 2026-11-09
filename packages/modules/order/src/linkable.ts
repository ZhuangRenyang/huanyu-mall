import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "order", fields: ["id", "status", "customer_id", "currency_code", "total_minor"] },
];
