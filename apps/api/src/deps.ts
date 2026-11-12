import {
  Container,
  EventBus,
  createLogger,
  prefixedUlid,
  PostgresDeadLetter,
  PostgresJournal,
  SubscriberRegistry,
  WorkflowEngine,
  type ModuleDefinition,
} from "@mall/core";
import type { Pool } from "pg";
import { resolveSmsProvider } from "./infra/sms-transport.js";
import { createEmailProvider } from "./infra/email-transport.js";
import regionChannelModule from "@mall/region-channel";
import productModule from "@mall/product";
import pricingModule from "@mall/pricing";
import taxModule from "@mall/tax";
import customerModule from "@mall/customer";
import fileModule from "@mall/file";
import authModule from "@mall/auth";
import inventoryModule from "@mall/inventory";
import cartModule from "@mall/cart";
import promotionModule from "@mall/promotion";
import orderModule from "@mall/order";
import paymentModule from "@mall/payment";
import fulfillmentModule from "@mall/fulfillment";
import themeModule from "@mall/theme";
import notificationModule, { NotificationDispatcher } from "@mall/notification";
import reviewModule from "@mall/review";
import { createWorkflowRegistry, registerSubscribers } from "@mall/workflows";
import type { IRegionChannelModuleService } from "@mall/region-channel";import type { IProductModuleService } from "@mall/product";
import type { IPricingModuleService } from "@mall/pricing";
import type { ITaxModuleService } from "@mall/tax";
import type { ICustomerModuleService } from "@mall/customer";
import type { IFileModuleService } from "@mall/file";
import type { IAuthModuleService } from "@mall/auth";
import type { IInventoryModuleService } from "@mall/inventory";
import type { ICartModuleService } from "@mall/cart";
import type { IPromotionModuleService } from "@mall/promotion";
import type { IOrderModuleService } from "@mall/order";
import type { IPaymentModuleService } from "@mall/payment";
import type { IFulfillmentModuleService } from "@mall/fulfillment";
import type { IThemeModuleService } from "@mall/theme";
import type { INotificationModuleService } from "@mall/notification";
import type { IReviewModuleService } from "@mall/review";
import type { ApiConfig } from "./config.js";
import { PgAuditRepository } from "./repositories/audit.repository.js";
import { PgSystemUpdateRepository } from "./repositories/system-update.repository.js";
import { AuditService } from "./services/audit.service.js";
import { SystemUpdateService } from "./services/system-update.service.js";

export interface AppServices {
  regionChannel: IRegionChannelModuleService;
  product: IProductModuleService;
  pricing: IPricingModuleService;
  tax: ITaxModuleService;
  customer: ICustomerModuleService;
  file: IFileModuleService;
  auth: IAuthModuleService;
  inventory: IInventoryModuleService;
  cart: ICartModuleService;
  promotion: IPromotionModuleService;
  order: IOrderModuleService;
  payment: IPaymentModuleService;
  fulfillment: IFulfillmentModuleService;
  theme: IThemeModuleService;
  notification: INotificationModuleService;
  review: IReviewModuleService;
  systemUpdate: SystemUpdateService;
}

export interface WorkflowRunner {
  run(
    workflow: unknown,
    input: unknown,
    opts?: { idempotencyKey?: string },
  ): Promise<{ result: unknown; executionId: string }>;
}

export interface AppDeps {
  config: ApiConfig;
  services: AppServices;
  workflow: WorkflowRunner;
  eventBus: EventBus;
  /** 审计留痕服务（后台写操作落 audit_log）。 */
  audit: AuditService;
  /** 通知派发器（可选：测试用的 fake deps 不提供，就不会起定时器）。 */
  notificationDispatcher?: { start(): void; stop(): void };
}

const MODULES: ModuleDefinition[] = [
  regionChannelModule,
  productModule,
  pricingModule,
  taxModule,
  customerModule,
  fileModule,
  authModule,
  inventoryModule,
  cartModule,
  promotionModule,
  orderModule,
  paymentModule,
  fulfillmentModule,
  themeModule,
  notificationModule,
  reviewModule,
];

/** 组合根：按依赖拓扑序把各业务模块注册进容器，实例化 workflow 引擎。 */
export function createRealDeps(pool: Pool, config: ApiConfig): AppDeps {
  const container = new Container();
  container.register("pool", () => pool);
  for (const mod of MODULES) container.register(mod.name, mod.service);

  /*
   * 短信通道（可选端口）：生产未配置时不注册，发码接口会明确报「未配置」，
   * 不会静默降级成日志发送（那等于验证码根本没发出去）。
   */
  const sms = resolveSmsProvider();
  if (sms) container.register("sms", () => ({ send: sms.send }));

  /*
   * 邮件验证码通道：复用通知模块的 SMTP 配置（商家只配一次）。
   * 始终注册 —— 是否真能发由通道内部判断：生产未配 SMTP 会明确报错，
   * 开发降级为日志（配合 AUTH_EXPOSE_DEV_CODE 自测）。
   */
  container.register("email", () =>
    createEmailProvider(container.resolve<INotificationModuleService>("notification")),
  );

  // Event Bus（正式版）：subscriber 注册 + 事件持久化
  const subscriberRegistry = new SubscriberRegistry();
  registerSubscribers(subscriberRegistry, (name) => container.resolve(name));
  const eventBus = new EventBus({ pool, registry: subscriberRegistry });

  // 领域事件发射端口：payment 等模块发事件用（模块间只走事件，payment 不依赖 order）
  container.register(
    "payment-events",
    () => async (event: { name: string; data: Record<string, unknown> }) => {
      await eventBus.publish({
        id: prefixedUlid("evt"),
        name: event.name,
        data: event.data,
        occurredAt: new Date().toISOString(),
      });
    },
  );

  // 履约发事件（发货 → 订单状态推进）；与 payment-events 同一套总线。
  container.register(
    "fulfillment-events",
    () => async (event: { name: string; data: Record<string, unknown> }) => {
      await eventBus.publish({
        id: prefixedUlid("evt"),
        name: event.name,
        data: event.data,
        occurredAt: new Date().toISOString(),
      });
    },
  );

  /*
   * 评价模块的订单端口：只为「评价必须挂在自己买过且已收货的订单上」。
   * 用适配器而不是让 review 直接依赖 order —— 模块图不新增边；
   * 延迟 resolve("order")：此刻 services 还没构造完。
   */
  container.register("review-order-port", () => ({
    getOrder: async (orderId: string) => {
      const order = await container
        .resolve<IOrderModuleService>("order")
        .retrieveOrder(orderId)
        .catch(() => null);
      if (!order) return null;
      return {
        id: order.id,
        customer_id: order.customer_id,
        status: order.status,
        items: order.items.map((i) => ({ product_id: i.product_id, title: i.title })),
      };
    },
  }));

  const services: AppServices = {
    regionChannel: container.resolve<IRegionChannelModuleService>("region-channel"),
    product: container.resolve<IProductModuleService>("product"),
    pricing: container.resolve<IPricingModuleService>("pricing"),
    tax: container.resolve<ITaxModuleService>("tax"),
    customer: container.resolve<ICustomerModuleService>("customer"),
    file: container.resolve<IFileModuleService>("file"),
    auth: container.resolve<IAuthModuleService>("auth"),
    inventory: container.resolve<IInventoryModuleService>("inventory"),
    cart: container.resolve<ICartModuleService>("cart"),
    promotion: container.resolve<IPromotionModuleService>("promotion"),
    order: container.resolve<IOrderModuleService>("order"),
    payment: container.resolve<IPaymentModuleService>("payment"),
    fulfillment: container.resolve<IFulfillmentModuleService>("fulfillment"),
    theme: container.resolve<IThemeModuleService>("theme"),
    notification: container.resolve<INotificationModuleService>("notification"),
    review: container.resolve<IReviewModuleService>("review"),
    systemUpdate: new SystemUpdateService(new PgSystemUpdateRepository(pool), config),
  };

  // workflow 端口适配器：camelCase 端口契约 ↔ module service（id/snake_case DTO，架构铁律 5）
  const orderPort = {
    createOrder: async (input: unknown) => {
      const order = await services.order.createOrder(input as never);
      return { orderId: order.id, totalMinor: order.total_minor };
    },
    cancelOrder: (orderId: string) => services.order.cancelOrder(orderId),
  };
  const inventoryPort = {
    allocateAndReserve: async (input: {
      orderId: string;
      items: Array<{ variantId: string; quantity: number }>;
    }) => {
      const r = await services.inventory.allocateAndReserve(input);
      return { reservationIds: r.reservationIds };
    },
    releaseReservation: (id: string) => services.inventory.releaseReservation(id),
  };
  const paymentPort = {
    createPaymentCollection: async (input: unknown) => {
      const pc = await services.payment.createPaymentCollection(input as never);
      return { paymentCollectionId: pc.id };
    },
  };

  const engine = new WorkflowEngine({
    journal: new PostgresJournal(pool),
    deadLetter: new PostgresDeadLetter(pool),
    registry: createWorkflowRegistry(),
    logger: createLogger({ level: config.logLevel }),
    resolve: (name) => {
      if (name === "order") return orderPort;
      if (name === "inventory") return inventoryPort;
      if (name === "payment") return paymentPort;
      return container.resolve(name);
    },
  });
  // workflow runner：把事件通过 eventBus.publish 接线到 outbox + subscriber
  const workflowRunner: WorkflowRunner = {
    async run(workflow, input, opts) {
      return engine.run(workflow as never, input, {
        idempotencyKey: opts?.idempotencyKey,
        emit: (event) => eventBus.publish(event),
      });
    },
  };

  const logger = createLogger({ level: config.logLevel });

  // 事件订阅者只落库，这里异步发信（ADR-016：SMTP 超时不能拖住下单）
  const notificationDispatcher = new NotificationDispatcher({ service: services.notification });

  return {
    config,
    services,
    workflow: workflowRunner,
    eventBus,
    audit: new AuditService(new PgAuditRepository(pool), logger),
    notificationDispatcher,
  };
}
