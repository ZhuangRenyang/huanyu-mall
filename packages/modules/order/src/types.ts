/** M05 Order DTO 与契约（对齐架构 §2.1）。K4：一期只开全额退款。 */

export type OrderStatus =
  | "pending"
  | "awaiting_payment"
  | "paid"
  | "partially_fulfilled"
  | "fulfilled"
  | "delivered"
  | "completed"
  | "canceled"
  /** 退款审核中：买家已申请，等待商家同意/拒绝（淘宝的「退款中」）。 */
  | "refund_pending"
  | "refunded";

export type PaymentStatus = "unpaid" | "authorized" | "captured" | "refunded";
export type Actor = "customer" | "admin" | "system" | "workflow";
export type OrderDiscountType = "catalogue" | "order" | "voucher" | "gift_card";

export interface OrderDTO {
  id: string;
  status: OrderStatus;
  cart_id: string | null;
  customer_id: string | null;
  email: string;
  currency_code: string;
  channel_id: string;
  region_id: string;
  subtotal_minor: bigint;
  shipping_minor: bigint;
  tax_minor: bigint;
  discount_minor: bigint;
  total_minor: bigint;
  payment_status: PaymentStatus;
  shipping_address: Record<string, unknown>;
  payment_collection_id: string | null;
  placed_at: string | null;
  /** 商家内部备注（仅后台可见，不下发店面）。 */
  merchant_note: string | null;
  /**
   * 顾客留言（淘宝下单页的「给卖家留言」）：
   * 顾客自己与商家都能看到，所以要下发店面；与 merchant_note 的可见范围相反。
   */
  customer_note: string | null;
}

/** 顾客留言上限（字符数）。淘宝同量级；服务端按此截断，前端也用同一常量做计数。 */
export const CUSTOMER_NOTE_MAX_LENGTH = 200;

export interface OrderLineItemDTO {
  id: string;
  order_id: string;
  variant_id: string;
  product_id: string;
  title: string;
  sku: string;
  quantity: number;
  unit_price_minor: bigint;
  tax_rate_bps: number;
  tax_amount_minor: bigint;
  total_minor: bigint;
  currency_code: string;
  options: Record<string, string> | null;
}

export interface OrderShippingMethodDTO {
  id: string;
  order_id: string;
  name: string;
  carrier_name: string | null;
  amount_minor: bigint;
  currency_code: string;
}

/** 订单折扣留痕（order_discount 表）：不可变，记录「哪个促销给了多少钱」（资金安全硬约束 5）。 */
export interface OrderDiscountDTO {
  id: string;
  order_id: string;
  promotion_id: string;
  code: string | null;
  amount_minor: bigint;
  type: OrderDiscountType;
  created_at: Date;
}

export interface OrderDetailDTO extends OrderDTO {
  items: OrderLineItemDTO[];
  shipping_method: OrderShippingMethodDTO | null;
  discounts: OrderDiscountDTO[];
}

export interface CreateOrderLineInput {
  variantId: string;
  productId: string;
  title: string;
  sku: string;
  quantity: number;
  unitPriceMinor: bigint;
  taxRateBps?: number;
  taxAmountMinor?: bigint;
  options?: Record<string, string>;
  /** 下单时变体完整快照（冻结，之后不回查目录）。 */
  snapshot: Record<string, unknown>;
}

/** 命中的促销折扣明细入参（固化进 order_discount）。 */
export interface CreateOrderDiscountInput {
  type: OrderDiscountType;
  promotionId: string;
  code: string | null;
  amountMinor: bigint;
}

export interface CreateOrderInput {
  cartId?: string | null;
  customerId?: string | null;
  email: string;
  currencyCode: string;
  channelId: string;
  regionId: string;
  shippingAddress: Record<string, unknown>;
  billingAddress?: Record<string, unknown> | null;
  items: CreateOrderLineInput[];
  shippingMinor?: bigint;
  /**
   * 运费税额（minor）：订单税 = 商品行税 + 运费税。
   * 不传就是把运费的税丢了——购物车显示含运费税、订单少收一份（真机踩到过）。
   */
  shippingTaxMinor?: bigint;
  discountMinor?: bigint;
  /**
   * 税是否已含在价格里（ADR-018）。
   * true  → 合计不再加税（税已含在行价内，只是拆出来报账）；
   * false → 合计要加上税。两种口径混用就是重复收税。
   */
  pricesIncludeTax?: boolean;
  /** 折扣留痕明细（服务端算好传入，禁客户端传价）。 */
  discounts?: CreateOrderDiscountInput[];
  paymentCollectionId?: string | null;
  /**
   * 顾客留言（「给卖家留言」）。空白视为没写；超过 CUSTOMER_NOTE_MAX_LENGTH 由服务层截断，
   * 不抛错——顾客已经点了一次「下单」，为一个备注把他挡回去不值得。
   */
  customerNote?: string | null;
}

export type RefundRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "canceled"
  /** 商家已同意退货，等买家寄回（**不动钱**）。 */
  | "awaiting_return"
  /** 买家已寄回，等商家确认收货（此时才允许打款）。 */
  | "returned";
export type RefundRequestSource = "customer" | "merchant";

/**
 * 售后类型（淘宝的「仅退款 / 退货退款」）。
 *
 * - `refund_only`：没收到货 / 不想要了 → 商家同意即打款，货不用寄回；
 * - `return_refund`：已收到货要退 → 商家同意后进入「待买家寄回」，
 *   **买家填了退货单号、商家确认收到货才打款**。
 *
 * 两者混用就是资金风险：把已发货的订单按「仅退款」处理，等于钱退货不还。
 */
export type RefundResolution = "refund_only" | "return_refund";

/** 退款申请单（售后单据）。真正打款记录在 payment.refund，这里只记业务处理。 */
export interface RefundRequestDTO {
  id: string;
  order_id: string;
  customer_id: string | null;
  amount_minor: bigint;
  currency_code: string;
  reason: string;
  source: RefundRequestSource;
  status: RefundRequestStatus;
  /** 售后类型：仅退款 / 退货退款（ADR-051）。 */
  resolution: RefundResolution;
  /**
   * 同意退货时快照的退货地址（ADR-061）。
   *
   * 不是实时读店铺配置：商家后来改地址，顾客看到的仍是当初被告知的那个 ——
   * 他手上的包裹可能已经按旧地址寄出了。
   */
  return_address: string | null;
  /** 买家退货物流（退货退款才有）。 */
  return_carrier: string | null;
  return_tracking_number: string | null;
  /** 买家提交退货物流的时间。 */
  return_shipped_at: string | null;
  /** 商家确认收到退货的时间。 */
  return_received_at: string | null;
  /** 商家处理说明（拒绝时必填）。 */
  review_note: string | null;
  reviewed_at: string | null;
  /** 资金流水 id；未执行退款时为空。 */
  refund_id: string | null;
  /** 申请时的订单状态：拒绝/撤销时据此精确恢复。 */
  order_status_before: OrderStatus | null;
  created_at: string;
  /** 列表展示用：下单邮箱（join 出来，省得前端再查一次）。 */
  order_email?: string | null;
}

export interface RefundRequestQuery {
  status?: RefundRequestStatus;
  /** 只看某张订单的申请（店面顾客查自己的进度用）。 */
  orderId?: string;
  limit?: number;
  offset?: number;
}

/**
 * 客户维度的订单汇总（后台客户列表）。
 *
 * 口径：只算**已付款且未退款**的订单（paid / partially_fulfilled / fulfilled / delivered / completed）。
 * 把已取消、退款中、已退款算进「累计消费」，商家会以为客户花了很多钱，
 * 实际那些钱要么没付、要么已经退回去了。
 */
export interface CustomerOrderSummaryDTO {
  customer_id: string;
  order_count: number;
  total_spent_minor: bigint;
  /** 最近一次下单时间（ISO），没下过单为 null。 */
  last_order_at: string | null;
}

export interface OrderQuery {
  limit?: number;
  offset?: number;
  status?: OrderStatus;
  /** 多状态筛选（后台页签：待发货 = paid + partially_fulfilled）。 */
  statuses?: OrderStatus[];
  /** 关键字：订单号或顾客邮箱（后台订单搜索）。 */
  q?: string;
  /** 按购物车反查订单（支付侧复用 workflow 建好的支付集合时用）。 */
  cartId?: string;
  /** 只看某个顾客的订单（店面「我的订单」）。 */
  customerId?: string;
  /**
   * 下单时间范围（含边界，ADR-056）：后台按日期对账/批量发货用。
   * 用 createdAt（订单落库时间）而不是 placed_at：两者通常相同，
   * 但 createdAt 一定有值，历史数据里 placed_at 可能为空。
   */
  createdFrom?: Date;
  createdTo?: Date;
}

export interface OrderRepository {
  /** 写商家备注；null 表示清空。 */
  setMerchantNote(id: string, note: string | null): Promise<OrderDTO | null>;

  // ---- 退款申请单 ----
  insertRefundRequest(input: {
    id: string;
    orderId: string;
    customerId: string | null;
    amountMinor: bigint;
    currencyCode: string;
    reason: string;
    source: RefundRequestSource;
    orderStatusBefore: OrderStatus;
    resolution: RefundResolution;
  }): Promise<RefundRequestDTO>;
  findRefundRequest(id: string): Promise<RefundRequestDTO | null>;
  /**
   * 该订单是否已有**在途**申请（pending / awaiting_return / returned）。
   *
   * 只查 pending 是不够的：买家在「等寄回」期间再提一张，商家会退两次。
   * 唯一索引也拦（两条 partial 索引合起来），但先给友好错误。
   */
  findActiveRefundRequest(orderId: string): Promise<RefundRequestDTO | null>;
  listRefundRequests(q: RefundRequestQuery): Promise<{ items: RefundRequestDTO[]; count: number }>;
  /** 各状态单据数（退款管理页签角标，一次 GROUP BY）。 */
  countRefundRequestsByStatus(): Promise<Record<string, number>>;
  updateRefundRequest(
    id: string,
    patch: {
      status: RefundRequestStatus;
      reviewNote?: string | null;
      refundId?: string | null;
      /** 商家确认收到退货的时间（退货退款专用）。 */
      returnReceivedAt?: Date | null;
      /** 同意退货时快照的退货地址（ADR-061）。 */
      returnAddress?: string | null;
    },
  ): Promise<RefundRequestDTO | null>;
  /**
   * 买家提交退货物流：只改 `return_*` 与状态，**不碰 reviewed_at**
   * —— 那是商家处理时间，买家寄件不算商家处理。
   */
  setReturnShipment(
    id: string,
    input: { carrier: string; trackingNumber: string; shippedAt: Date },
  ): Promise<RefundRequestDTO | null>;
  insertOrder(input: {
    id: string;
    cartId?: string | null;
    customerId?: string | null;
    email: string;
    currencyCode: string;
    channelId: string;
    regionId: string;
    subtotalMinor: bigint;
    shippingMinor: bigint;
    taxMinor: bigint;
    discountMinor: bigint;
    totalMinor: bigint;
    shippingAddress: Record<string, unknown>;
    billingAddress?: Record<string, unknown> | null;
    paymentCollectionId?: string | null;
    /** 顾客留言（已归一化：空串已转 null、超长已截断）。 */
    customerNote?: string | null;
  }): Promise<OrderDTO>;
  insertLineItems(
    orderId: string,
    lines: Array<{
      variantId: string;
      productId: string;
      title: string;
      sku: string;
      quantity: number;
      unitPriceMinor: bigint;
      taxRateBps: number;
      taxAmountMinor: bigint;
      totalMinor: bigint;
      currencyCode: string;
      options?: Record<string, string> | null;
    }>,
  ): Promise<OrderLineItemDTO[]>;
  insertSnapshots(items: Array<{ orderLineItemId: string; snapshot: Record<string, unknown> }>): Promise<void>;
  insertShippingMethod(
    orderId: string,
    input: { name: string; carrierName?: string | null; amountMinor: bigint; currencyCode: string },
  ): Promise<void>;
  /** 折扣留痕：把命中的促销明细固化进 order_discount（不可变，资金安全硬约束 5）。 */
  insertDiscounts(
    orderId: string,
    discounts: Array<CreateOrderDiscountInput>,
  ): Promise<void>;
  listDiscounts(orderId: string): Promise<OrderDiscountDTO[]>;
  insertStatusHistory(
    orderId: string,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    actor: Actor,
    reason?: string | null,
  ): Promise<void>;
  findById(id: string): Promise<OrderDTO | null>;
  listLineItems(orderId: string): Promise<OrderLineItemDTO[]>;
  findShippingMethod(orderId: string): Promise<OrderShippingMethodDTO | null>;
  list(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }>;
  /** 批量取行项（列表页要显示商品，禁 N+1）。 */
  listLineItemsByOrderIds(orderIds: string[]): Promise<OrderLineItemDTO[]>;
  /** 按客户聚合订单数与消费额（一次 GROUP BY，禁 N+1）。 */
  summarizeByCustomerIds(customerIds: string[]): Promise<CustomerOrderSummaryDTO[]>;
  /** 各状态订单数（一次 GROUP BY）。 */
  countByStatus(): Promise<Record<string, number>>;
  /**
   * 各变体的累计销量（ADR-067）。
   *
   * 口径：订单状态属于「已成交」的那几档（已付款/已发货/已收货/已完成）的行数量之和，
   * 未付款、已取消、退款中、已退款都不算。销量是社交证明，虚高会让顾客不信任。
   */
  countSoldByVariantIds(variantIds: string[]): Promise<Record<string, number>>;
  /** 某时刻之后「已付款」订单数与金额（工作台「今日」口径）。 */
  summarizePaidSince(since: Date): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }>;
  updateStatus(id: string, status: OrderStatus): Promise<void>;
  updatePaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void>;
}

export interface IOrderModuleService {
  createOrder(input: CreateOrderInput): Promise<OrderDetailDTO>;
  /** 各状态订单数（后台工作台与订单页签角标，一次 GROUP BY）。 */
  countByStatus(): Promise<Record<string, number>>;
  /** 各变体累计销量（ADR-067）。 */
  countSoldByVariants(variantIds: string[]): Promise<Record<string, number>>;
  /** 某时刻之后「已付款」订单数与金额（工作台「今日」口径）。 */
  summarizePaidSince(since: Date): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }>;
  retrieveOrder(id: string): Promise<OrderDetailDTO>;
  /** 写商家备注（仅后台可见）；传 null/空串即清空。 */
  setMerchantNote(id: string, note: string | null): Promise<OrderDetailDTO>;
  listOrders(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }>;
  /** 按客户聚合订单数与消费额（后台客户列表）。 */
  summarizeByCustomerIds(customerIds: string[]): Promise<CustomerOrderSummaryDTO[]>;
  /** 各状态订单数（一次 GROUP BY）。 */
  countByStatus(): Promise<Record<string, number>>;
  /** 某时刻之后「已付款」订单数与金额（工作台「今日」口径）。 */
  summarizePaidSince(since: Date): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }>;
  /** 列表 + 行项（店面「我的订单」要显示商品；一次批量取，不做 N+1）。 */
  listOrderSummaries(
    q: OrderQuery,
  ): Promise<{ items: Array<OrderDTO & { items: OrderLineItemDTO[] }>; count: number }>;
  transition(id: string, to: OrderStatus, meta: { actor: Actor; reason?: string }): Promise<OrderDTO>;
  /** 创建退款申请单（买家申请或商家主动），落库为 pending。 */
  createRefundRequest(
    orderId: string,
    input: {
      amountMinor: bigint;
      reason: string;
      source: RefundRequestSource;
      customerId?: string | null;
      /** 售后类型，缺省「仅退款」（老客户端不带这个字段）。 */
      resolution?: RefundResolution;
    },
  ): Promise<RefundRequestDTO>;
  /** 后台退款列表（按状态筛选，分页），附各状态计数供页签角标使用。 */
  listRefundRequests(
    q: RefundRequestQuery,
  ): Promise<{ items: RefundRequestDTO[]; count: number; counts: Record<string, number> }>;
  findRefundRequest(id: string): Promise<RefundRequestDTO | null>;
  /** 同意「仅退款」：退款执行成功后回写资金流水 id 与状态。 */
  approveRefundRequest(id: string, refundId: string, reviewNote?: string | null): Promise<RefundRequestDTO>;
  /**
   * 同意「退货退款」：只把单据推进到 awaiting_return，**不打款**。
   * 钱要等买家寄回、商家确认收货（confirmReturnReceived）才动。
   */
  agreeReturnRequest(
    id: string,
    opts?: {
      reviewNote?: string | null;
      /**
       * 同意时的退货地址（ADR-061）：由调用方从店铺配置读出并快照。
       * 服务层不读主题设置 —— 跨模块依赖留在组合根，模块只管存。
       */
      returnAddress?: string | null;
    },
  ): Promise<RefundRequestDTO>;
  /** 买家提交退货物流（awaiting_return → returned）。 */
  shipReturn(
    id: string,
    input: { carrier: string; trackingNumber: string },
  ): Promise<RefundRequestDTO>;
  /**
   * 商家确认收到退货：退货退款的**唯一打款关卡**。
   * 调用方必须先跑完退款 workflow，再把 refundId 传进来（顺序与仅退款一致：先钱后状态）。
   */
  confirmReturnReceived(
    id: string,
    refundId: string,
    reviewNote?: string | null,
  ): Promise<RefundRequestDTO>;
  /** 拒绝退款：理由必填。只有 pending 可拒（已同意退货的不在此列）。 */
  rejectRefundRequest(id: string, reviewNote: string): Promise<RefundRequestDTO>;
  /** 买家撤销（pending / awaiting_return 可撤）。 */
  cancelRefundRequest(id: string): Promise<RefundRequestDTO>;
  markRefundSettled(orderId: string, refundRequestId: string): Promise<OrderDTO>;
  cancelOrder(id: string): Promise<void>;
}
