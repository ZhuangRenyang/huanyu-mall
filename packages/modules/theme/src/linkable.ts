import type { LinkableDefinition } from "@mall/core";

export const linkable: LinkableDefinition[] = [
  { entity: "theme_settings", fields: ["id", "primary_color", "gradient_color", "accent_color"] },
];
