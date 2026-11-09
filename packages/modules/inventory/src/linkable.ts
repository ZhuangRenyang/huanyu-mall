import type { LinkableDefinition } from "@mall/core";

/** inventory_item / stock_location 可被 links join（inventory_item_variant / stock_location_channel）。 */
export const linkable: LinkableDefinition[] = [
  { entity: "inventory_item", fields: ["id", "sku", "title", "requires_shipping"] },
  { entity: "stock_location", fields: ["id", "name", "priority"] },
];
