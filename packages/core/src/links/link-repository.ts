import { prefixedUlid } from "../utils/index.js";
import type { LinkDefinition } from "./types.js";

const IDENT_RE = /^[a-z][a-z0-9_]*$/;

export interface LinkRow {
  id: string;
  leftId: string;
  rightId: string;
  [key: string]: unknown;
}

export type BuiltQuery = { sql: string; params: unknown[] };

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return name;
}

/**
 * 关联表 repository（架构 §4.4）。
 * 只做参数化 SQL 构建 + 可选执行；无业务分支。dismiss=软删，delete=硬删（仅 cascade）。
 */
export class LinkRepository {
  constructor(private readonly def: LinkDefinition) {}

  private get leftField(): string {
    return ident(this.def.left.field);
  }
  private get rightField(): string {
    return ident(this.def.right.field);
  }

  buildInsert(leftId: string, rightId: string, extra: Record<string, unknown> = {}): BuiltQuery {
    const columns = ["id", this.leftField, this.rightField, ...Object.keys(extra).map(ident)];
    const params: unknown[] = [prefixedUlid("lnk"), leftId, rightId, ...Object.values(extra)];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
    return {
      sql: `INSERT INTO ${ident(this.def.table)} (${columns.join(", ")}) VALUES (${placeholders})`,
      params,
    };
  }

  buildDismiss(id: string): BuiltQuery {
    return {
      sql: `UPDATE ${ident(this.def.table)} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      params: [id],
    };
  }

  buildDelete(id: string): BuiltQuery {
    return {
      sql: `DELETE FROM ${ident(this.def.table)} WHERE id = $1`,
      params: [id],
    };
  }

  buildRestore(id: string): BuiltQuery {
    return {
      sql: `UPDATE ${ident(this.def.table)} SET deleted_at = NULL WHERE id = $1`,
      params: [id],
    };
  }

  buildListByLeft(leftId: string): BuiltQuery {
    return {
      sql: `SELECT * FROM ${ident(this.def.table)} WHERE ${this.leftField} = $1 AND deleted_at IS NULL`,
      params: [leftId],
    };
  }

  buildListByRight(rightId: string): BuiltQuery {
    return {
      sql: `SELECT * FROM ${ident(this.def.table)} WHERE ${this.rightField} = $1 AND deleted_at IS NULL`,
      params: [rightId],
    };
  }

  buildBatchGet(ids: string[]): BuiltQuery {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    return {
      sql: `SELECT * FROM ${ident(this.def.table)} WHERE id IN (${placeholders})`,
      params: [...ids],
    };
  }
}
