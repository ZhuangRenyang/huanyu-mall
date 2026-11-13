import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OrderStatus } from "@mall/order";
import { PaginationQuerySchema } from "@mall/types";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { cancelOrderAndReleaseStock } from "../../lib/cancel-order.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { mapAdminOrder, mapOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";
import { moneyCell, timeCell, toCsv } from "../../lib/csv.js";

/**
 * 商家发起退款只需要理由：金额一律取订单实付。
 * 让客户端传金额，等于给「退多退少」开了口子。
 */
const refundBody = z.object({ reason: z.string().min(2).max(500) });
const createFulfillmentBody = z.object({
  items: z.array(z.object({ order_line_item_id: z.string(), quantity: z.number().int().min(1) })).min(1),
  reservation_ids: z.array(z.string()).optional(),
  // 发货仓（ADR-013 §3）：订单预留跨多仓时必填，单仓时可省略。
  stock_location_id: z.string().min(1).optional(),
});
/**
 * 日期参数：只收 YYYY-MM-DD（淘宝的时间筛选也是按天）。
 *
 * 不让前端传任意时间戳：那样「今天」到底按谁的时区算就说不清了 ——
 * 商家在深圳开的店，用 UTC 切日会凭空少掉 8 小时的单。
 * 日期一律按**店铺运行环境的本地日**解释：from 取当天 00:00，to 取当天 23:59:59.999。
 */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");

/** 列表筛选：状态页签（逗号分隔）+ 订单号/邮箱搜索 + 下单日期范围。 */
const adminOrderListQuery = PaginationQuerySchema.extend({
  status: z.string().max(120).optional(),
  q: z.string().min(1).max(80).optional(),
  /** 起始日期（含当天 00:00）。 */
  from: dateOnly.optional(),
  /** 结束日期（含当天 23:59:59.999）。 */
  to: dateOnly.optional(),
});

/** 'YYYY-MM-DD' → 当天起点/终点（本地时区）。非法日期返回 null，由调用方忽略。 */
function dayRange(from?: string, to?: string): { createdFrom?: Date; createdTo?: Date } {
  const parse = (s: string, endOfDay: boolean): Date | null => {
    const d = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const start = from ? parse(from, false) : null;
  const end = to ? parse(to, true) : null;
  return {
    ...(start ? { createdFrom: start } : {}),
    ...(end ? { createdTo: end } : {}),
  };
}
/**
 * 订单导出（ADR-057）：与列表同一套筛选，只多一个数量上限。
 *
 * 上限不是性能借口，是「导出的东西必须能被人看完」：
 * 一次 5 万行的表格没人核对，反而掩盖问题。要更多就按日期分几批。
 */
const ORDERS_EXPORT_LIMIT = 5000;

const adminOrderExportQuery = z.object({
  status: z.string().max(120).optional(),
  q: z.string().min(1).max(80).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

/** 订单状态的中文标签（导出给人看，不导出 paid/fulfilled 这种内部值）。 */
const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  awaiting_payment: "待付款",
  paid: "已付款/待发货",
  partially_fulfilled: "部分发货",
  fulfilled: "已发货",
  delivered: "已签收",
  completed: "已完成",
  canceled: "已取消",
  refund_pending: "退款中",
  refunded: "已退款",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: "未付款",
  authorized: "已授权",
  captured: "已收款",
  refunded: "已退款",
};

/** 导出表头：按对账顺序排（钱与收货信息在前，物流在后）。 */
const ORDER_EXPORT_HEADER = [
  "订单号",
  "下单时间",
  "订单状态",
  "支付状态",
  "顾客邮箱",
  "收件人",
  "电话",
  "国家/地区",
  "省/州",
  "城市",
  "详细地址",
  "邮编",
  "商品",
  "件数",
  "商品小计",
  "运费",
  "税费",
  "优惠",
  "实付",
  "币种",
  "物流公司",
  "运单号",
  "顾客留言",
];

/** 收货地址字段（结账写入的结构）→ 字符串，缺的给空串而不是 undefined。 */
function addrField(addr: Record<string, unknown>, key: string): string {
  const v = addr[key];
  return v === null || v === undefined ? "" : String(v);
}

const addShipmentBody = z.object({
  carrier_name: z.string(),
  tracking_number: z.string(),
  shipped_at: z.string().optional(),
});

/** Admin 订单 6 端点（openapi 1405/1435/1456/1477/1504/1529）。 */
export function adminOrderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  app.get(
    "/api/v1/admin/orders",
    { preHandler: guard, schema: { querystring: adminOrderListQuery } },
    async (req, reply) => {
      const q = req.query as {
        limit: number;
        offset: number;
        status?: string;
        q?: string;
        from?: string;
        to?: string;
      };
      // 页签是多状态（待发货 = paid + partially_fulfilled），所以用逗号分隔而不是单值
      const statuses = q.status
        ? (q.status.split(",").map((s) => s.trim()).filter(Boolean) as OrderStatus[])
        : undefined;
      const range = dayRange(q.from, q.to);
      const [res, counts] = await Promise.all([
        deps.services.order.listOrderSummaries({
          limit: q.limit,
          offset: q.offset,
          ...(statuses ? { statuses } : {}),
          ...(q.q ? { q: q.q } : {}),
          ...range,
        }),
        /*
         * 页签角标**不随日期过滤**：它是「全店还有多少单要处理」，
         * 随筛选变会让商家以为待发货真的少了。前端有说明文案。
         */
        deps.services.order.countByStatus(),
      ]);
      /*
       * 售后进度角标（ADR-073）：一页订单一次 IN 查询。
       * 没有它，列表只能靠订单状态笼统写「退款中」——
       * 商家分不清「该我审」还是「等买家寄回」，两件事的动作完全不同。
       */
      const activeRefunds = await deps.services.order.listActiveRefundsByOrderIds(
        res.items.map((o) => o.id),
      );
      reply.ok({
        // 行项一并返回：列表的「商品」列没有它就是一列空白
        items: res.items.map((o) => ({ ...mapOrder(o), refund: activeRefunds[o.id] ?? null })),
        count: res.count,
        counts,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  /**
   * 导出 CSV（ADR-057）。
   *
   * 走的是与列表完全相同的筛选（状态 / 关键字 / 日期），商家看到什么就导出什么 ——
   * 另起一套查询条件，导出结果迟早和界面对不上。
   */
  app.get(
    "/api/v1/admin/orders/export",
    { preHandler: guard, schema: { querystring: adminOrderExportQuery } },
    async (req, reply) => {
      const q = req.query as { status?: string; q?: string; from?: string; to?: string };
      const statuses = q.status
        ? (q.status.split(",").map((s) => s.trim()).filter(Boolean) as OrderStatus[])
        : undefined;
      const filter = {
        ...(statuses ? { statuses } : {}),
        ...(q.q ? { q: q.q } : {}),
        ...dayRange(q.from, q.to),
      };

      // 先探总数：超过上限直接拒绝，而不是悄悄截断（截断的表格最容易被当成全量对账）
      const probe = await deps.services.order.listOrderSummaries({ ...filter, limit: 1, offset: 0 });
      if (probe.count > ORDERS_EXPORT_LIMIT) {
        throw errors.validation(
          `一次最多导出 ${ORDERS_EXPORT_LIMIT} 单（当前 ${probe.count} 单），请缩小时间范围或按状态分批`,
        );
      }

      const res =
        probe.count === 0
          ? { items: [] }
          : await deps.services.order.listOrderSummaries({
              ...filter,
              limit: probe.count,
              offset: 0,
            });

      // 运单一次性取回（一条 join），不给每单各查一次
      const tracking = await deps.services.fulfillment.listFirstTrackingByOrderIds(
        res.items.map((o) => o.id),
      );
      const trackingByOrder = new Map(tracking.map((t) => [t.orderId, t]));

      const rows: unknown[][] = [ORDER_EXPORT_HEADER];
      for (const o of res.items) {
        const addr = o.shipping_address ?? {};
        const t = trackingByOrder.get(o.id);
        rows.push([
          o.id,
          timeCell(o.placed_at),
          ORDER_STATUS_LABEL[o.status] ?? o.status,
          PAYMENT_STATUS_LABEL[o.payment_status] ?? o.payment_status,
          o.email,
          addrField(addr, "name"),
          addrField(addr, "phone"),
          addrField(addr, "country"),
          addrField(addr, "province"),
          addrField(addr, "city"),
          addrField(addr, "address_1"),
          addrField(addr, "postal_code"),
          // 商品合并成一格：一行一单才对得上账，一行一商品会让「实付」重复出现
          o.items.map((li) => `${li.title} ×${li.quantity}`).join("；"),
          o.items.reduce((n, li) => n + li.quantity, 0),
          moneyCell(o.subtotal_minor, o.currency_code),
          moneyCell(o.shipping_minor, o.currency_code),
          moneyCell(o.tax_minor, o.currency_code),
          moneyCell(o.discount_minor, o.currency_code),
          moneyCell(o.total_minor, o.currency_code),
          o.currency_code,
          t?.carrier ?? "",
          t?.number ?? "",
          o.customer_note ?? "",
        ]);
      }

      const stamp = timeCell(new Date().toISOString()).replace(/[-: ]/g, "").slice(0, 12);
      await deps.audit.record(
        auditEntry(req, {
          action: "order.export",
          entityType: "order",
          entityId: `export_${stamp}`,
          after: { count: res.items.length, filter },
        }),
      );

      reply
        .header("content-type", "text/csv; charset=utf-8")
        // 文件名用 ASCII：中文文件名在部分浏览器/代理上会变成乱码
        .header("content-disposition", `attachment; filename="orders-${stamp}.csv"`)
        .header("cache-control", "no-store")
        .send(toCsv(rows));
    },
  );

  app.get("/api/v1/admin/orders/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.ok(mapAdminOrder(await deps.services.order.retrieveOrder(id)));
  });

  /**
   * 商家备注（淘宝订单详情里的「商家备注」）。
   *
   * 只存后台，店面接口不下发；空串等于清空。
   */
  app.put(
    "/api/v1/admin/orders/:id/note",
    { preHandler: guard, schema: { body: z.object({ note: z.string().max(1000).nullable() }) } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { note } = req.body as { note: string | null };
      const before = await deps.services.order.retrieveOrder(id);
      const after = await deps.services.order.setMerchantNote(id, note);
      await deps.audit.record(
        auditEntry(req, {
          action: "order.note.update",
          entityType: "order",
          entityId: id,
          before: { merchant_note: before.merchant_note },
          after: { merchant_note: after.merchant_note },
        }),
      );
      reply.ok(mapAdminOrder(after));
    },
  );

  /**
   * 订单操作日志（谁在什么时候改了什么）。
   *
   * 单独开这个端点而不是复用 /admin/audit-logs：后者要 settings 权限，
   * 客服/运营拿不到；这里只要 orders 权限，且强制限定在**本订单**范围内。
   */
  app.get("/api/v1/admin/orders/:id/logs", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await deps.audit.query({
      entityType: "order",
      entityId: id,
      limit: 50,
      offset: 0,
    });
    reply.ok(res);
  });

  /**
   * 发货计划：按预留自动算出「每个仓发哪些订单行、各几件」。
   *
   * 拆分订单不再让操作员选仓、分行填数量——系统算好，人只填运单号。
   * 预留若映射不到订单行（数据异常），计入 unmatched_quantity 供排查，不静默丢。
   */
  app.get("/api/v1/admin/orders/:id/fulfillment-plan", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [order, reservations] = await Promise.all([
      deps.services.order.retrieveOrder(id),
      deps.services.inventory.listReservationsByOrder(id),
    ]);

    const lineByVariant = new Map(order.items.map((li) => [li.variant_id, li]));
    const plans = new Map<
      string,
      { stockLocationId: string; items: Map<string, number>; total: number }
    >();
    let unmatched = 0;

    for (const r of reservations) {
      const line = r.variant_id ? lineByVariant.get(r.variant_id) : undefined;
      if (!line) {
        unmatched += r.quantity;
        continue;
      }
      const plan = plans.get(r.stock_location_id) ?? {
        stockLocationId: r.stock_location_id,
        items: new Map<string, number>(),
        total: 0,
      };
      plan.items.set(line.id, (plan.items.get(line.id) ?? 0) + r.quantity);
      plan.total += r.quantity;
      plans.set(r.stock_location_id, plan);
    }

    const items = [...plans.values()]
      .sort((a, b) => a.stockLocationId.localeCompare(b.stockLocationId))
      .map((p) => ({
        stock_location_id: p.stockLocationId,
        total_quantity: p.total,
        items: [...p.items].map(([order_line_item_id, quantity]) => ({
          order_line_item_id,
          quantity,
        })),
      }));

    reply.ok({ plans: items, count: items.length, unmatched_quantity: unmatched });
  });

  // 已发货的仓与运单：跨仓订单靠它看「还差哪个仓没发」（ADR-013 §3）。
  app.get("/api/v1/admin/orders/:id/fulfillments", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const items = await deps.services.fulfillment.listByOrder(id);
    reply.ok({ items, count: items.length });
  });

  app.post("/api/v1/admin/orders/:id/cancel", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.order.retrieveOrder(id);
    // 取消必须释放预留库存（ADR-075）：只改状态 = 这几件货永远卖不出去
    await cancelOrderAndReleaseStock(deps, id);
    const after = await deps.services.order.retrieveOrder(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "order.cancel",
        entityType: "order",
        entityId: id,
        before,
        after,
      }),
    );
    reply.ok(mapAdminOrder(after));
  });

  /**
   * 商家在订单详情发起退款（建申请单，不直接打款）。
   *
   * **所有退款都必须经过后台人工审核**：这里只把单据放进「退款管理 → 待处理」，
   * 订单同时转「退款中」并冻结发货。真正打款只发生在
   * `POST /admin/refund-requests/:id/approve`。
   *
   * 订单详情也直接退的话，等于给「退款」开了两条路，审核就成了可选步骤。
   */
  app.post(
    "/api/v1/admin/orders/:id/refunds",
    { preHandler: guard, schema: { body: refundBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof refundBody>;
      const before = await deps.services.order.retrieveOrder(id);

      const request = await deps.services.order.createRefundRequest(id, {
        // 金额取订单实付，不接受客户端传值
        amountMinor: before.total_minor,
        reason: b.reason,
        source: "merchant",
      });
      const after = await deps.services.order.retrieveOrder(id);
      await deps.audit.record(
        auditEntry(req, {
          action: "order.refund.request",
          entityType: "order",
          entityId: id,
          before,
          after: { refund: request, order: after },
        }),
      );
      reply.code(201).ok({ refund: request, order: mapAdminOrder(after) });
    },
  );

  /**
   * 订单预留明细（含仓）：后台按仓拆发货单前先让操作员选仓。
   * 只读，不写审计。
   */
  app.get("/api/v1/admin/orders/:id/reservations", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.services.order.retrieveOrder(id);
    const reservations = await deps.services.inventory.listReservationsByOrder(id);
    reply.ok({
      items: reservations.map((r) => ({
        id: r.id,
        stock_location_id: r.stock_location_id,
        quantity: r.quantity,
        inventory_item_id: r.inventory_item_id,
      })),
      count: reservations.length,
    });
  });

  app.post(
    "/api/v1/admin/orders/:id/fulfillments",
    { preHandler: guard, schema: { body: createFulfillmentBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof createFulfillmentBody>;

      /*
       * 退款审核中禁止发货。
       * 只把订单标成「退款中」却在别处照常发货，等于审核没生效 —— 货发了、钱也退了。
       */
      const order = await deps.services.order.retrieveOrder(id);
      if (order.status === "refund_pending") {
        throw errors.invalidState("订单正在退款审核中，不能发货。请先在「退款管理」处理退款申请");
      }
      if (order.status === "refunded") {
        throw errors.invalidState("订单已退款，不能发货");
      }

      const fulfillment = await deps.services.fulfillment.createFulfillment({
        orderId: id,
        stockLocationId: b.stock_location_id,
        items: b.items.map((i) => ({ orderLineItemId: i.order_line_item_id, quantity: i.quantity })),
        reservationIds: b.reservation_ids ?? [],
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "fulfillment.create",
          entityType: "fulfillment",
          entityId: fulfillment.id,
          after: fulfillment,
        }),
      );
      reply.code(201).ok(fulfillment);
    },
  );

  app.post(
    "/api/v1/admin/fulfillments/:id/shipments",
    { preHandler: guard, schema: { body: addShipmentBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof addShipmentBody>;

      // 发货单可能在建单时已存在（那时还没申请退款），填运单号才是真正发货 —— 同样要拦
      const fulfillment = await deps.services.fulfillment.findFulfillment(id);
      if (fulfillment) {
        const order = await deps.services.order.retrieveOrder(fulfillment.order_id);
        if (order.status === "refund_pending") {
          throw errors.invalidState("订单正在退款审核中，不能发货。请先在「退款管理」处理退款申请");
        }
        if (order.status === "refunded") {
          throw errors.invalidState("订单已退款，不能发货");
        }
      }

      const shipment = await deps.services.fulfillment.addShipment(id, {
        carrierName: b.carrier_name,
        trackingNumber: b.tracking_number,
        shippedAt: b.shipped_at ? new Date(b.shipped_at) : new Date(),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipment.create",
          entityType: "shipment",
          entityId: shipment.id,
          after: shipment,
        }),
      );
      reply.code(201).ok(shipment);
    },
  );
}
