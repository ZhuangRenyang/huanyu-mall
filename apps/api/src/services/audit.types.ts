/** 审计日志领域类型（与 audit_log 表字段一一对应，命名沿用接口层 snake_case 风格）。 */

/** 操作者类型：admin（后台人员）/ customer（顾客或匿名访客）/ system（系统回调）。 */
export type AuditActorType = "admin" | "customer" | "system";

/** 待写入的审计条目（服务层入参，不含 HTTP 对象）。 */
export interface AuditEntry {
  actorType: AuditActorType;
  actorId: string | null;
  /** 动作名，形如 product.create / order.refund / payment.capture。 */
  action: string;
  /** 实体类型，形如 product / order / payment_provider。 */
  entityType: string;
  entityId: string | null;
  /** 变更前快照（null 表示无前置状态，如新建）。 */
  before?: unknown;
  /** 变更后快照（null 表示无后置状态，如删除）。 */
  after?: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** 已落库的审计记录。 */
export interface AuditRecord {
  id: string;
  actor_type: AuditActorType;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

/** 审计查询条件（时间范围用 ISO 8601 字符串）。 */
export interface AuditQuery {
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  offset: number;
}

export interface AuditQueryResult {
  items: AuditRecord[];
  count: number;
}
