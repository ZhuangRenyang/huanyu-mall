import type { Pool } from "pg";
import { prefixedUlid } from "@mall/core";
import type {
  AuditEntry,
  AuditQuery,
  AuditQueryResult,
  AuditRecord,
} from "../services/audit.types.js";
import { toJsonSafe } from "../utils/json.js";

/** 审计仓储：只做数据存取，不含业务判断。 */
export interface AuditRepository {
  insert(entry: AuditEntry): Promise<void>;
  query(filter: AuditQuery): Promise<AuditQueryResult>;
}

const INSERT_SQL = `
  INSERT INTO audit_log
    (id, actor_type, actor_id, action, entity_type, entity_id, "before", "after", ip, user_agent, request_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

const SELECT_COLUMNS = `
  id, actor_type, actor_id, action, entity_type, entity_id,
  "before", "after", ip, user_agent, request_id, created_at
`;

/** PostgreSQL 实现：全部走参数化查询（禁字符串拼接，防 SQL 注入）。 */
export class PgAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async insert(entry: AuditEntry): Promise<void> {
    await this.pool.query(INSERT_SQL, [
      prefixedUlid("audit"),
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId,
      toJsonSafe(entry.before),
      toJsonSafe(entry.after),
      entry.ip,
      entry.userAgent,
      entry.requestId,
    ]);
  }

  async query(filter: AuditQuery): Promise<AuditQueryResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.action) {
      values.push(filter.action);
      conditions.push(`action = $${values.length}`);
    }
    if (filter.entityType) {
      values.push(filter.entityType);
      conditions.push(`entity_type = $${values.length}`);
    }
    if (filter.entityId) {
      values.push(filter.entityId);
      conditions.push(`entity_id = $${values.length}`);
    }
    if (filter.from) {
      values.push(filter.from);
      conditions.push(`created_at >= $${values.length}::timestamptz`);
    }
    if (filter.to) {
      values.push(filter.to);
      conditions.push(`created_at <= $${values.length}::timestamptz`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countRes = await this.pool.query(
      `SELECT count(*)::int AS count FROM audit_log ${where}`,
      values,
    );

    values.push(filter.limit, filter.offset);
    const limitIndex = values.length - 1;
    const offsetIndex = values.length;
    const rows = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM audit_log ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      values,
    );

    return {
      items: rows.rows.map(toAuditRecord),
      count: Number(countRes.rows[0]?.count ?? 0),
    };
  }
}

function toAuditRecord(row: Record<string, unknown>): AuditRecord {
  return {
    id: String(row.id),
    actor_type: row.actor_type as AuditRecord["actor_type"],
    actor_id: (row.actor_id as string | null) ?? null,
    action: String(row.action),
    entity_type: String(row.entity_type),
    entity_id: (row.entity_id as string | null) ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: (row.ip as string | null) ?? null,
    user_agent: (row.user_agent as string | null) ?? null,
    request_id: (row.request_id as string | null) ?? null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}
