import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { NotificationService } from "../src/services/notification.service.js";
import { NotificationDispatcher } from "../src/services/dispatcher.js";
import { formatMinor } from "../src/services/money.js";
import { escapeHtml, renderOrderConfirmation, renderRefundUpdate } from "../src/services/templates.js";
import type {
  NotificationRepository,
  NotificationRow,
  NotificationSettingsDTO,
  NotificationSettingsRecord,
  NotificationStatus,
  OrderConfirmationPayload,
} from "../src/types.js";

/** 内存仓储：与 SQL 语义对齐（领取条件、幂等插入、失败排期）。 */
class InMemoryRepo implements NotificationRepository {
  rows = new Map<string, NotificationRow>();
  settings: NotificationSettingsRecord | null = null;
  private seq = 0;

  async getSettings() {
    return this.settings ? { ...this.settings } : null;
  }

  async upsertSettings(
    patch: Partial<NotificationSettingsDTO> & { smtp_password_enc?: string | null },
  ): Promise<NotificationSettingsRecord> {
    const base: NotificationSettingsRecord = this.settings ?? {
      enabled: false,
      from_name: "",
      from_email: "",
      smtp_host: "",
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: "",
      smtp_password_set: false,
      smtp_password_enc: null,
      order_confirmation_enabled: true,
      shipment_enabled: true,
      stock_alert_enabled: true,
      refund_enabled: true,
      storefront_url: "",
    };
    this.settings = {
      ...base,
      ...("enabled" in patch ? { enabled: patch.enabled! } : {}),
      ...("from_name" in patch ? { from_name: patch.from_name! } : {}),
      ...("from_email" in patch ? { from_email: patch.from_email! } : {}),
      ...("smtp_host" in patch ? { smtp_host: patch.smtp_host! } : {}),
      ...("smtp_port" in patch ? { smtp_port: patch.smtp_port! } : {}),
      ...("smtp_secure" in patch ? { smtp_secure: patch.smtp_secure! } : {}),
      ...("smtp_user" in patch ? { smtp_user: patch.smtp_user! } : {}),
      ...("order_confirmation_enabled" in patch
        ? { order_confirmation_enabled: patch.order_confirmation_enabled! }
        : {}),
      ...("shipment_enabled" in patch ? { shipment_enabled: patch.shipment_enabled! } : {}),
      ...("stock_alert_enabled" in patch ? { stock_alert_enabled: patch.stock_alert_enabled! } : {}),
      ...("refund_enabled" in patch ? { refund_enabled: patch.refund_enabled! } : {}),
      ...("storefront_url" in patch ? { storefront_url: patch.storefront_url! } : {}),
      ...(patch.smtp_password_enc !== undefined
        ? {
            smtp_password_enc: patch.smtp_password_enc,
            smtp_password_set: Boolean(patch.smtp_password_enc),
          }
        : {}),
    };
    return { ...this.settings };
  }

  async insertIfAbsent(
    row: Omit<NotificationRow, "created_at" | "sent_at" | "next_attempt_at">,
  ): Promise<NotificationRow | null> {
    for (const r of this.rows.values()) {
      if (r.dedupe_key === row.dedupe_key) return null;
    }
    const full: NotificationRow = {
      ...row,
      next_attempt_at: null,
      created_at: new Date(),
      sent_at: null,
    };
    this.rows.set(full.id, full);
    return full;
  }

  async claimBatch(limit: number): Promise<NotificationRow[]> {
    const now = Date.now();
    const picked = [...this.rows.values()]
      .filter(
        (r) =>
          r.attempts < 3 &&
          (r.status === "pending"
            ? r.next_attempt_at === null || r.next_attempt_at.getTime() <= now
            : r.status === "failed" &&
              r.next_attempt_at !== null &&
              r.next_attempt_at.getTime() <= now),
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, limit);
    for (const r of picked) {
      r.status = "sending";
      r.attempts += 1;
    }
    return picked;
  }

  async markSent(id: string) {
    const r = this.rows.get(id);
    if (!r) return;
    r.status = "sent";
    r.sent_at = new Date();
    r.error = null;
    r.next_attempt_at = null;
  }

  async markFailed(id: string, error: string, retryDelaySeconds: number | null) {
    const r = this.rows.get(id);
    if (!r) return;
    r.status = "failed";
    r.error = error;
    r.next_attempt_at =
      retryDelaySeconds === null ? null : new Date(Date.now() + retryDelaySeconds * 1000);
  }

  async resetForResend(id: string) {
    const r = this.rows.get(id);
    if (!r) return null;
    r.status = "sending";
    r.attempts = 1;
    r.error = null;
    r.next_attempt_at = null;
    r.sent_at = null;
    return r;
  }

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async list(q: { limit: number; offset: number; status?: NotificationStatus }) {
    const all = [...this.rows.values()]
      .filter((r) => (q.status ? r.status === q.status : true))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { items: all.slice(q.offset, q.offset + q.limit), count: all.length };
  }
}

const payload: OrderConfirmationPayload = {
  orderId: "ord_1",
  orderNumber: "ABC123",
  email: "buyer@example.com",
  currencyCode: "CNY",
  items: [
    { title: "无线静音鼠标", sku: "MS-BLK", quantity: 2, unitPriceMinor: 9900, totalMinor: 19800 },
  ],
  subtotalMinor: 19800,
  shippingMinor: 800,
  taxMinor: 0,
  discountMinor: 0,
  totalMinor: 20600,
  shippingAddress: { name: "张三", city: "深圳", address_1: "科技园路 1 号" },
};

async function setup(overrides?: Partial<NotificationSettingsDTO>) {
  const repo = new InMemoryRepo();
  const sent: Array<{ to: string; subject: string }> = [];
  const service = new NotificationService(repo, async (_cfg, msg) => {
    sent.push({ to: msg.to, subject: msg.subject });
  });
  await service.updateSettings({
    enabled: true,
    from_name: "测试商城",
    from_email: "noreply@example.com",
    smtp_host: "smtp.example.com",
    smtp_port: 587,
    ...overrides,
  });
  return { repo, service, sent };
}

describe("NotificationService 入队（ADR-016：事件里只落库）", () => {
  it("功能关闭时入队不落库，不制造噪音", async () => {
    const { repo, service } = await setup({ enabled: false });
    await service.enqueueOrderConfirmation(payload);
    expect(repo.rows.size).toBe(0);
  });

  it("开启后落库为 pending；同一订单重复事件只留一条（幂等）", async () => {
    const { repo, service } = await setup();
    await service.enqueueOrderConfirmation(payload);
    await service.enqueueOrderConfirmation(payload);
    expect(repo.rows.size).toBe(1);
    const row = [...repo.rows.values()][0]!;
    expect(row.status).toBe("pending");
    expect(row.dedupe_key).toBe("order:ord_1:confirmation");
    expect(row.to_email).toBe("buyer@example.com");
  });

  it("发货通知按 fulfillmentId 去重：两个仓 = 两封信", async () => {
    const { repo, service } = await setup();
    const ship = {
      orderId: "ord_1",
      orderNumber: "ABC123",
      email: "buyer@example.com",
      carrier: "顺丰速运",
      trackingNumber: "SF1",
      items: [{ title: "无线静音鼠标", quantity: 1 }],
      shippedAt: "2026-11-11 10:00",
    };
    await service.enqueueShipmentNotification("fulf_1", ship);
    await service.enqueueShipmentNotification("fulf_1", ship);
    await service.enqueueShipmentNotification("fulf_2", { ...ship, trackingNumber: "SF2" });
    expect(repo.rows.size).toBe(2);
  });
});

describe("派发与重试", () => {
  it("成功 → sent", async () => {
    const { repo, service, sent } = await setup();
    await service.enqueueOrderConfirmation(payload);
    const dispatcher = new NotificationDispatcher({ service });
    await dispatcher.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("buyer@example.com");
    const row = [...repo.rows.values()][0]!;
    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
  });

  it("发送失败 → failed + 可读错误 + 排期重试；超过 3 次不再自动重试", async () => {
    const repo = new InMemoryRepo();
    let calls = 0;
    const service = new NotificationService(repo, async () => {
      calls += 1;
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    });
    await service.updateSettings({
      enabled: true,
      from_email: "noreply@example.com",
      smtp_host: "127.0.0.1",
    });
    await service.enqueueOrderConfirmation(payload);

    await service.claimPending(10).then((rows) =>
      Promise.all(rows.map((r) => service.deliverRow(r))),
    );
    let row = [...repo.rows.values()][0]!;
    expect(row.status).toBe("failed");
    expect(row.error).toContain("ECONNREFUSED");
    expect(row.next_attempt_at).not.toBeNull();

    // 把排期推到过去，继续自动重试：上限是「共 3 次尝试」
    for (let i = 0; i < 2; i += 1) {
      row.next_attempt_at = new Date(Date.now() - 1000);
      await service.claimPending(10).then((rows) =>
        Promise.all(rows.map((r) => service.deliverRow(r))),
      );
    }
    row = [...repo.rows.values()][0]!;
    expect(row.attempts).toBe(3);
    expect(row.status).toBe("failed");
    expect(row.next_attempt_at).toBeNull();
    // 达到上限后派发器不再领它
    const claimed = await service.claimPending(10);
    expect(claimed).toHaveLength(0);
    expect(calls).toBe(3);
  });

  it("手动重发失败不排期（操作员自己决定下一步）", async () => {
    const repo = new InMemoryRepo();
    let fail = true;
    const service = new NotificationService(repo, async () => {
      if (fail) throw new Error("SMTP 拒收");
    });
    await service.updateSettings({ enabled: true, from_email: "noreply@example.com", smtp_host: "h" });
    await service.enqueueOrderConfirmation(payload);
    const id = [...repo.rows.keys()][0]!;

    const first = await service.resend(id);
    expect(first.status).toBe("failed");
    expect(first.error).toContain("SMTP 拒收");
    expect(repo.rows.get(id)!.next_attempt_at).toBeNull();

    fail = false;
    const second = await service.resend(id);
    expect(second.status).toBe("sent");
  });

  it("手动重发失败后不会被派发器自动重发（next_attempt_at 为空 = 放弃）", async () => {
    const repo = new InMemoryRepo();
    const service = new NotificationService(repo, async () => {
      throw new Error("SMTP 拒收");
    });
    await service.updateSettings({ enabled: true, from_email: "noreply@example.com", smtp_host: "h" });
    await service.enqueueOrderConfirmation(payload);
    const id = [...repo.rows.keys()][0]!;
    await service.resend(id);
    expect(repo.rows.get(id)!.status).toBe("failed");
    expect(repo.rows.get(id)!.next_attempt_at).toBeNull();

    // 换成好的发信实现也不该被自动重发：它已经「放弃」了
    const claimed = await service.claimPending(10);
    expect(claimed).toHaveLength(0);
  });
});

describe("设置与安全", () => {
  it("密码加密存储、接口永不回显", async () => {
    const { service } = await setup();
    await service.updateSettings({ smtp_password: "s3cret" });
    const dto = await service.getSettings();
    expect(dto.smtp_password_set).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("s3cret");
  });

  it("端口越界 / 邮箱格式 / 店铺地址非法 → 可读业务错误", async () => {
    const { service } = await setup();
    await expect(service.updateSettings({ smtp_port: 70000 })).rejects.toBeInstanceOf(DomainError);
    await expect(service.updateSettings({ from_email: "not-an-email" })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(service.updateSettings({ storefront_url: "javascript:alert(1)" })).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});

describe("模板：转义与金额", () => {
  it("商品标题里的 HTML 会被转义（防邮件注入）", async () => {
    const { repo, service, sent } = await setup();
    await service.enqueueOrderConfirmation({
      ...payload,
      items: [
        {
          title: '<script>alert(1)</script>',
          sku: "X",
          quantity: 1,
          unitPriceMinor: 100,
          totalMinor: 100,
        },
      ],
    });
    const row = [...(await service.list({ limit: 10, offset: 0 })).items][0]!;
    expect(sent).toHaveLength(0);
    expect(row.subject).not.toContain("<script>");
    expect(row.subject).toContain("ABC123");
    // body_html 内也不该出现未转义的标签
    const raw = repo.rows.get(row.id)!;
    expect(raw.body_html).not.toContain("<script>alert");
    expect(raw.body_html).toContain("&lt;script&gt;");
  });

  it("formatMinor 用整数运算，金额不出现浮点误差", () => {
    expect(formatMinor(20600, "CNY")).toBe("¥206.00");
    expect(formatMinor(0, "CNY")).toBe("¥0.00");
    expect(formatMinor(100000001, "CNY")).toBe("¥1,000,000.01");
    expect(formatMinor(1234, "JPY")).toBe("¥1,234");
  });

  it("escapeHtml 覆盖五个危险字符", () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("确认邮件含订单号、商品行与合计", () => {
    const mail = renderOrderConfirmation(payload, {
      fromName: "测试商城",
      storefrontUrl: "https://shop.example.com",
    });
    expect(mail.subject).toBe("订单已确认 · ABC123");
    expect(mail.text).toContain("¥206.00");
    expect(mail.text).toContain("无线静音鼠标 × 2");
    expect(mail.html).toContain("600px");
  });
});

describe("退款进度通知（ADR-072）", () => {
  const refund = {
    refundRequestId: "rr_1",
    orderId: "ord_1",
    orderNumber: "ord_1",
    email: "buyer@example.com",
    amountMinor: 19800,
    currencyCode: "CNY",
    status: "return_agreed" as const,
    note: "请用顺丰寄回",
    returnAddress: "广东省深圳市南山区科技园路 1 号 张三 13800000000",
    reviewedAt: "2026-11-13 21:00",
  };

  it("退款开关关着 → 不落库（与其它交易邮件同一组开关）", async () => {
    const { repo, service } = await setup({ refund_enabled: false });
    await service.enqueueRefundUpdate(refund);
    expect(repo.rows.size).toBe(0);
  });

  it("「同意退货」与「已退款」是两封：去重键带档位", async () => {
    const { repo, service } = await setup();
    await service.enqueueRefundUpdate(refund);
    await service.enqueueRefundUpdate(refund); // 重复派发只留一封
    await service.enqueueRefundUpdate({ ...refund, status: "refunded", note: null });
    expect(repo.rows.size).toBe(2);
    const keys = [...repo.rows.values()].map((r) => r.dedupe_key).sort();
    expect(keys).toEqual(["refund:rr_1:refunded", "refund:rr_1:return_agreed"]);
  });

  it("退货地址进正文（取单据快照），且被转义", async () => {
    const mail = renderRefundUpdate(
      { ...refund, returnAddress: 'A 栋 <b>"前台"</b>' },
      { fromName: "测试商城", storefrontUrl: "https://shop.example.com" },
    );
    expect(mail.subject).toBe("退货申请已同意：订单 ord_1");
    expect(mail.html).toContain("退货地址");
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain("&lt;b&gt;");
    expect(mail.text).toContain("寄回后请在「我的订单」里填写退货物流单号");
  });

  it("拒绝邮件带拒绝理由，不写「退款金额已退」", async () => {
    const mail = renderRefundUpdate(
      { ...refund, status: "rejected", note: "商品已使用", returnAddress: null },
      { fromName: "测试商城", storefrontUrl: "" },
    );
    expect(mail.subject).toBe("退款申请未通过：订单 ord_1");
    expect(mail.text).toContain("未通过原因：商品已使用");
    expect(mail.text).not.toContain("已原路退回");
  });
});
