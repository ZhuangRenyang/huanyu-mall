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

export type RefundRequestStatus = "pending" | "approved" | "rejected" | "canceled";
export type RefundRequestSource = "customer" | "merchant";

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
  }): Promise<RefundRequestDTO>;
  findRefundRequest(id: string): Promise<RefundRequestDTO | null>;
  /** 该订单是否已有待处理申请（唯一索引也拦，但先给友好错误）。 */
  findPendingRefundRequest(orderId: string): Promise<RefundRequestDTO | null>;
  listRefundRequests(q: RefundRequestQuery): Promise<{ items: RefundRequestDTO[]; count: number }>;
  /** 各状态单据数（退款管理页签角标，一次 GROUP BY）。 */
  countRefundRequestsByStatus(): Promise<Record<string, number>>;
  updateRefundRequest(
    id: string,
    patch: { status: RefundRequestStatus; reviewNote?: string | null; refundId?: string | null },
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
  /** 某时刻之后「已付款」订单数与金额（工作台「今日」口径）。 */
  summarizePaidSince(since: Date): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }>;
  updateStatus(id: string, status: OrderStatus): Promise<void>;
  updatePaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void>;
}

export interface IOrderModuleService {
  createOrder(input: CreateOrderInput): Promise<OrderDetailDTO>;
  /** 各状态订单数（后台工作台与订单页签角标，一次 GROUP BY）。 */
  countByStatus(): Promise<Record<string, number>>;
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
    input: { amountMinor: bigint; reason: string; source: RefundRequestSource; customerId?: string | null },
  ): Promise<RefundRequestDTO>;
  /** 后台退款列表（按状态筛选，分页），附各状态计数供页签角标使用。 */
  listRefundRequests(
    q: RefundRequestQuery,
  ): Promise<{ items: RefundRequestDTO[]; count: number; counts: Record<string, number> }>;
  findRefundRequest(id: string): Promise<RefundRequestDTO | null>;
  /** 同意退款：退款执行成功后回写资金流水 id 与状态。 */
  approveRefundRequest(id: string, refundId: string, reviewNote?: string | null): Promise<RefundRequestDTO>;
  /** 拒绝退款：理由必填。 */
  rejectRefundRequest(id: string, reviewNote: string): Promise<RefundRequestDTO>;
  /** 买家撤销（只有 pending 可撤）。 */
  cancelRefundRequest(id: string): Promise<RefundRequestDTO>;
  markRefundSettled(orderId: string, refundRequestId: string): Promise<OrderDTO>;
  cancelOrder(id: string): Promise<void>;
}
