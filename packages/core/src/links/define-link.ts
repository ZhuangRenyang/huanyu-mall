import type { LinkDefinition } from "./types.js";

const TABLE_RE = /^[a-z][a-z0-9_]*$/;
const ON_DELETE = new Set(["restrict", "dismiss", "cascade"]);

/** define-link：声明式关联定义（架构 §4.4）。 */
export function defineLink(def: LinkDefinition): LinkDefinition {
  if (!TABLE_RE.test(def.table)) {
    throw new Error(`Invalid link table name: ${def.table}`);
  }
  if (!ON_DELETE.has(def.onDelete)) {
    throw new Error(`Invalid onDelete for ${def.table}: ${def.onDelete}`);
  }
  if (def.left.field === def.right.field && def.left.module === def.right.module) {
    throw new Error(`Self-join not allowed: ${def.table}`);
  }
  return {
    ...def,
    columns: def.columns ?? [],
    uniqueKeys: def.uniqueKeys ?? [],
  };
}
