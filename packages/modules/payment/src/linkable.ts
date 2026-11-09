import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "payment_collection", fields: ["id", "order_id", "currency_code", "amount_minor", "status"] },
  { entity: "payment_provider_config", fields: ["id", "identifier", "label", "is_enabled"] },
];
