import type { AuditRepository } from "../repositories/audit.repository.js";
import type {
  AuditEntry,
  AuditQuery,
  AuditQueryResult,
} from "./audit.types.js";
import type { AppLogger } from "../types/logger.js";

/**
 * 审计服务：把后台写操作落库。
 *
 * 关键约束：写审计失败只记 error 日志，绝不向上抛错。
 * 审计是旁路留痕，不能因为审计库抖动而让商品下单这类主业务请求失败。
 */
export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly logger: AppLogger,
  ) {}

  /** 记录一条审计；写入失败仅告警，不影响主流程。 */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.repo.insert(entry);
    } catch (err) {
      this.logger.error(
        {
          err,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
        },
        "审计日志写入失败，业务请求继续放行",
      );
    }
  }

  /** 审计查询（读路径失败向上抛错，由统一错误处理返回 500）。 */
  async query(filter: AuditQuery): Promise<AuditQueryResult> {
    return this.repo.query(filter);
  }
}
