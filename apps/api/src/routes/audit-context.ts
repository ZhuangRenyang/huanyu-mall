import type { FastifyRequest } from "fastify";
import type { AuditActorType, AuditEntry } from "../services/audit.types.js";

/** 路由层审计描述：业务代码只声明「做了什么、改了哪个实体」。 */
export interface AuditSpec {
  /** 动作名，形如 product.create。 */
  action: string;
  /** 实体类型，形如 product。 */
  entityType: string;
  entityId?: string | null;
  /** 变更前快照。 */
  before?: unknown;
  /** 变更后快照。 */
  after?: unknown;
  /** 覆盖默认操作者类型（默认按 token scope 推断；系统回调传 system）。 */
  actorType?: AuditActorType;
}

/**
 * 从请求构造审计条目：操作者、来源 IP、User-Agent、requestId 统一在此提取，
 * 路由处理器只关心业务语义。
 */
export function auditEntry(req: FastifyRequest, spec: AuditSpec): AuditEntry {
  const userAgent = req.headers["user-agent"];
  return {
    actorType: spec.actorType ?? actorTypeOf(req),
    actorId: req.auth?.sub ?? null,
    action: spec.action,
    entityType: spec.entityType,
    entityId: spec.entityId ?? null,
    before: spec.before,
    after: spec.after,
    ip: req.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
    requestId: req.id,
  };
}

/** 后台人员 → admin；顾客与匿名访客 → customer（匿名时 actor_id 为 null）。 */
function actorTypeOf(req: FastifyRequest): AuditActorType {
  return req.auth?.scope === "admin" ? "admin" : "customer";
}
