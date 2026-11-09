import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "admin_user", fields: ["id", "email", "name", "status"] },
];
