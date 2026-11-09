import type { LinkDefinition } from "./types.js";

const IDENT_RE = /^[a-z][a-z0-9_.]*$/;

export interface ComposeField {
  /** 完整列引用（如 "p.title"），由调用方按 linkable 白名单解析后传入。 */
  expression: string;
  alias?: string;
}

export interface ComposeFilter {
  expression: string;
  operator: "=" | "IN";
  value: unknown;
}

export interface ComposeSpec {
  entity: string;
  /** 主表（entity 的私有表）。 */
  from: string;
  alias: string;
  fields: ComposeField[];
  links: LinkDefinition[];
  filters?: ComposeFilter[];
  orderBy?: string;
  limit?: number;
  offset?: number;
}

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

/**
 * query-composer：把「主查询 + 若干 link」编译成一条 LEFT JOIN SQL（架构 §4.4）。
 * 唯一允许跨模块读的地方；只 join 关联表，不 join 对方私有表。一期仅单库 join。
 * 字段白名单（linkable）解析在调用方完成，本函数只做 SQL 拼接。
 */
export function compileCompose(spec: ComposeSpec): CompiledQuery {
  const params: unknown[] = [];

  const select = spec.fields
    .map((f) => (f.alias ? `${ident(f.expression)} AS ${ident(f.alias)}` : ident(f.expression)))
    .join(", ");

  const joins = spec.links
    .map((link, i) => {
      const alias = `lk${i + 1}`;
      return (
        `LEFT JOIN ${ident(link.table)} ${alias} ` +
        `ON ${alias}.${ident(link.left.field)} = ${ident(spec.alias)}.id ` +
        `AND ${alias}.deleted_at IS NULL`
      );
    })
    .join("\n");

  const whereClauses: string[] = [];
  for (const f of spec.filters ?? []) {
    params.push(f.value);
    const placeholder = `$${params.length}`;
    whereClauses.push(
      f.operator === "IN" ? `${ident(f.expression)} = ANY(${placeholder})` : `${ident(f.expression)} = ${placeholder}`,
    );
  }
  const where = whereClauses.length > 0 ? `\nWHERE ${whereClauses.join(" AND ")}` : "";

  let sql = `SELECT ${select}\nFROM ${ident(spec.from)} ${ident(spec.alias)}\n${joins}${where}`;
  if (spec.orderBy) sql += `\nORDER BY ${spec.orderBy}`;
  if (spec.limit != null) {
    params.push(spec.limit);
    sql += `\nLIMIT $${params.length}`;
  }
  if (spec.offset != null) {
    params.push(spec.offset);
    sql += `\nOFFSET $${params.length}`;
  }
  return { sql, params };
}

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return name;
}
