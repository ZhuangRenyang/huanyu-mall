import { loadConfig } from "../../src/config.js";
import type { RateLimitConfig } from "../../src/config.js";
import type { AppDeps } from "../../src/deps.js";
import type { AppLogger } from "../../src/types/logger.js";
import type { AuditRepository } from "../../src/repositories/audit.repository.js";
import type {
  AuditEntry,
  AuditQuery,
  AuditQueryResult,
  AuditRecord,
} from "../../src/services/audit.types.js";
import { AuditService } from "../../src/services/audit.service.js";
import type {
  RateLimitStore,
  RateLimitStoreCallback,
  RateLimitStoreCtor,
} from "../../src/plugins/rate-limit-store.js";
import { makeFakeServices, type FakeServicesState } from "./fake-services.js";
/** 静默 logger：测试里吞掉日志，只关心行为。 */
export const silentLogger: AppLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** 可控时钟：限流测试不真等窗口，靠 advance 推进时间。 */
export interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

export function createFakeClock(start = Date.now()): FakeClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

type Counter = { current: number; expiresAt: number };

/**
 * 假限流存储：实现 @fastify/rate-limit 的 store 契约（incr/child），
 * 固定窗口计数，与 Redis 实现语义一致，但不需要真 Redis、不需要真等。
 * 计数表由外部共享，保证「工厂造出的实例」与「测试断言用的实例」看到同一份状态。
 */
export class FakeRateLimitStore implements RateLimitStore {
  constructor(
    private readonly clock: FakeClock,
    private readonly counters: Map<string, Counter>,
  ) {}

  incr(key: string, cb: RateLimitStoreCallback, timeWindow: number): void {
    const now = this.clock.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.counters.set(key, { current: 1, expiresAt: now + timeWindow });
      cb(null, { current: 1, ttl: timeWindow });
      return;
    }
    existing.current += 1;
    cb(null, { current: existing.current, ttl: existing.expiresAt - now });
  }

  child(): RateLimitStore {
    return this;
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of this.counters) out[key] = value.current;
    return out;
  }
}

export interface FakeRateLimitFixture {
  factory: (config: RateLimitConfig, logger: AppLogger) => RateLimitStoreCtor;
  store: FakeRateLimitStore;
  counters: Map<string, Counter>;
}

/** 生成注入给限流插件的 store 工厂（测试用）。 */
export function createFakeRateLimit(clock: FakeClock): FakeRateLimitFixture {
  const counters = new Map<string, Counter>();
  const store = new FakeRateLimitStore(clock, counters);
  const factory = (): RateLimitStoreCtor =>
    class FakeStoreCtor extends FakeRateLimitStore {
      constructor() {
        super(clock, counters);
      }
    };
  return { factory, store, counters };
}

/** 内存审计仓储：可注入写入故障，验证「审计写失败不阻塞主流程」。 */
export class InMemoryAuditRepository implements AuditRepository {
  readonly rows: (AuditEntry & { created_at: string })[] = [];
  failNextInsert = false;

  async insert(entry: AuditEntry): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("审计库写入失败（测试注入故障）");
    }
    this.rows.push({ ...entry, created_at: new Date().toISOString() });
  }

  async query(filter: AuditQuery): Promise<AuditQueryResult> {
    const matched = this.rows.filter((row) => {
      if (filter.action && row.action !== filter.action) return false;
      if (filter.entityType && row.entityType !== filter.entityType) return false;
      if (filter.entityId && row.entityId !== filter.entityId) return false;
      if (filter.from && new Date(row.created_at) < new Date(filter.from)) return false;
      if (filter.to && new Date(row.created_at) > new Date(filter.to)) return false;
      return true;
    });
    const start = filter.offset;
    return {
      items: matched.slice(start, start + filter.limit).map((row) => toAuditRecord(row)),
      count: matched.length,
    };
  }
}

function toAuditRecord(row: AuditEntry & { created_at: string }): AuditRecord {
  return {
    id: `audit_${row.created_at}_${row.action}`,
    actor_type: row.actorType,
    actor_id: row.actorId,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: row.ip,
    user_agent: row.userAgent,
    request_id: row.requestId,
    created_at: row.created_at,
  };
}

export interface AuditFixture {
  service: AuditService;
  repo: InMemoryAuditRepository;
}

export function makeAuditFixture(): AuditFixture {
  const repo = new InMemoryAuditRepository();
  return { service: new AuditService(repo, silentLogger), repo };
}

const INITIAL_THEME: Record<string, unknown> = {
  id: "theme_default",
  primary_color: "#1666D9",
  gradient_color: "#5B8DEF",
  accent_color: "#FF6B35",
  font_family: "Archivo",
  border_radius: "8px",
  shadow: "none",
  logo_file_id: null,
  product_image_ratio: "4:5",
  metadata: null,
};

export function makeDeps(): AppDeps & {
  seen: Set<string>;
  auditRepo: InMemoryAuditRepository;
  /** 共享状态：测试可以改订单是否已创建、分类列表等前置条件。 */
  state: FakeServicesState;
} {
  const state: FakeServicesState = {
    seen: new Set<string>(),
    providerConfig: new Map<string, Record<string, string>>(),
    theme: { ...INITIAL_THEME },
    adminPassword: "pw123456",
    revokedRefreshTokens: 0,
    orderCreated: false,
    registerMode: "email",
    categories: [
      { id: "cat_1", name: "服饰", handle: "apparel", parent_id: null, sort_order: 0, product_count: 1 },
      { id: "cat_2", name: "外套", handle: "coats", parent_id: "cat_1", sort_order: 0, product_count: 0 },
    ],
  };
  const auditFixture = makeAuditFixture();
  const services = makeFakeServices(state);
  // 退款工作流要回 refundId（真实实现由 payment 生成）
  const workflow = {
    run: async () => ({ result: { orderId: "ord_1", refundId: "rfd_1" }, executionId: "wf_1" }),
  };

  return {
    config: {
      ...loadConfig({}),
      databaseUrl: "",
      redisUrl: "",
      logLevel: "silent",
      corsOrigins: [],
    },
    services: services as unknown as AppDeps["services"],
    workflow,
    eventBus: {} as AppDeps["eventBus"],
    audit: auditFixture.service,
    seen: state.seen,
    auditRepo: auditFixture.repo,
    state,
  };
}
