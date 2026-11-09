import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "customer", fields: ["id", "email", "first_name", "last_name", "phone"] },
];
