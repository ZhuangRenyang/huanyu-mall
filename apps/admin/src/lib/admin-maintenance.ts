/**
 * 维护模块数据层（ADR-076）。
 *
 * 对齐 CRMEB「设置 → 维护」：商家不该为了看一眼数据库通不通、邮件堵没堵
 * 去翻日志文件或问开发。这里只读，不提供任何破坏性动作。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export type ProbeState = 'ok' | 'degraded';

export interface MaintenanceView {
  /** 演示模式：数据为本地模拟，界面要如实标出来。 */
  demo: boolean;
  system: {
    status: ProbeState;
    db: ProbeState;
    redis: ProbeState;
    queue: ProbeState;
    /** 最新已应用迁移文件名；探针失败为 degraded。 */
    migrations: string;
    /** 进程运行秒数。 */
    uptime: number;
    node: string;
    env: string;
    now: string;
  };
  mail: {
    pending: number;
    failed: number;
    sent: number;
  };
  data: {
    orders: number;
    products: number;
    customers: number;
  };
  audit: {
    count: number;
    recent: Array<{
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      actor: string;
      createdAt: string;
    }>;
  };
}

interface ApiMaintenance {
  system?: {
    status?: ProbeState;
    db?: ProbeState;
    redis?: ProbeState;
    queue?: ProbeState;
    migrations?: string;
    uptime?: number;
    node?: string;
    env?: string;
    now?: string;
  };
  mail?: { pending?: number; failed?: number; sent?: number };
  data?: { orders?: number; products?: number; customers?: number };
  audit?: {
    count?: number;
    recent?: Array<{
      id?: string;
      action?: string;
      entity_type?: string;
      entity_id?: string | null;
      actor_type?: string;
      actor_id?: string | null;
      created_at?: string;
    }>;
  };
}

/** 演示模式：不假装探针真的跑过，界面会显示「演示数据」。 */
const DEMO: MaintenanceView = {
  demo: true,
  system: {
    status: 'ok',
    db: 'ok',
    redis: 'ok',
    queue: 'ok',
    migrations: 'demo',
    uptime: 0,
    node: '—',
    env: 'demo',
    now: new Date().toISOString(),
  },
  mail: { pending: 0, failed: 0, sent: 0 },
  data: { orders: 0, products: 0, customers: 0 },
  audit: { count: 0, recent: [] },
};

export async function getMaintenance(): Promise<MaintenanceView> {
  if (getAdminApiMode() !== 'live') return { ...DEMO, system: { ...DEMO.system } };

  const raw = (await adminClient().getMaintenanceStatus()) as ApiMaintenance;
  return {
    demo: false,
    system: {
      status: raw.system?.status === 'ok' ? 'ok' : 'degraded',
      db: raw.system?.db === 'ok' ? 'ok' : 'degraded',
      redis: raw.system?.redis === 'ok' ? 'ok' : 'degraded',
      queue: raw.system?.queue === 'ok' ? 'ok' : 'degraded',
      migrations: String(raw.system?.migrations ?? 'unknown'),
      uptime: Number(raw.system?.uptime ?? 0),
      node: String(raw.system?.node ?? '—'),
      env: String(raw.system?.env ?? 'unknown'),
      now: String(raw.system?.now ?? new Date().toISOString()),
    },
    mail: {
      pending: Number(raw.mail?.pending ?? 0),
      failed: Number(raw.mail?.failed ?? 0),
      sent: Number(raw.mail?.sent ?? 0),
    },
    data: {
      orders: Number(raw.data?.orders ?? 0),
      products: Number(raw.data?.products ?? 0),
      customers: Number(raw.data?.customers ?? 0),
    },
    audit: {
      count: Number(raw.audit?.count ?? 0),
      recent: (raw.audit?.recent ?? []).map((r) => ({
        id: String(r.id ?? ''),
        action: String(r.action ?? ''),
        entityType: String(r.entity_type ?? ''),
        entityId: r.entity_id ?? null,
        // 审计里 actor 是类型 + id；列表上只显示「管理员 / 系统」
        actor: r.actor_type === 'admin' ? (r.actor_id ?? '管理员') : '系统',
        createdAt: String(r.created_at ?? ''),
      })),
    },
  };
}

/** 清理超时未付款订单（ADR-087）：人工触发，返回取消数量。 */
export async function expireUnpaidOrders(minutes: number): Promise<{ scanned: number; canceled: number }> {
  if (getAdminApiMode() !== 'live') return { scanned: 0, canceled: 0 };
  const res = (await adminClient().expireUnpaidOrders({ minutes })) as {
    scanned?: number;
    canceled?: number;
  };
  return { scanned: Number(res.scanned ?? 0), canceled: Number(res.canceled ?? 0) };
}
