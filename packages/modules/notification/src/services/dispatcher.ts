import type { INotificationModuleService } from "../types.js";

/**
 * 发信派发器（ADR-016）。
 *
 * 为什么不在事件里直接发：EventBus 是同步 await subscriber 的，SMTP 一次超时就是十几秒，
 * 会把下单/支付请求拖死。这里改成「事件只落库 → 派发器定时领取发送」。
 *
 * 领取在仓储里是一条 `FOR UPDATE SKIP LOCKED` 的 UPDATE，多进程部署也不会重复发。
 */
export class NotificationDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: {
      service: INotificationModuleService;
      /** 轮询间隔，默认 5 秒；测试里可调小或不起定时器。 */
      intervalMs?: number;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    const interval = this.deps.intervalMs ?? 5_000;
    this.timer = setInterval(() => {
      void this.drain().catch(() => {
        // 单轮失败不影响下一轮：错误已写进 notification.error
      });
    }, interval);
    // 不阻塞进程退出
    this.timer.unref?.();
    // 启动时立刻放一轮，进程重启后滞留的 pending 不用等 5 秒
    void this.drain().catch(() => {});
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async drain(limit = 10): Promise<void> {
    const rows = await this.deps.service.claimPending(limit);
    for (const row of rows) {
      await this.deps.service.deliverRow(row);
    }
  }
}
