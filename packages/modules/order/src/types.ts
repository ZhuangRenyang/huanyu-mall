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
}

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
  created_at: string;
  /** 列表展示用：下单邮箱（join 出来，省得前端再查一次）。 */
  order_email?: string | null;
}

export interface RefundRequestQuery {
  status?: RefundRequestStatus;
  limit?: number;
  offset?: number;
}

export interface OrderQuery {
  limit?: number;
  offset?: number;
  status?: OrderStatus;
  /** 按购物车反查订单（支付侧复用 workflow 建好的支付集合时用）。 */
  cartId?: string;
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
  }): Promise<RefundRequestDTO>;
  findRefundRequest(id: string): Promise<RefundRequestDTO | null>;
  /** 该订单是否已有待处理申请（唯一索引也拦，但先给友好错误）。 */
  findPendingRefundRequest(orderId: string): Promise<RefundRequestDTO | null>;
  listRefundRequests(q: RefundRequestQuery): Promise<{ items: RefundRequestDTO[]; count: number }>;
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
  updateStatus(id: string, status: OrderStatus): Promise<void>;
  updatePaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void>;
}

export interface IOrderModuleService {
  createOrder(input: CreateOrderInput): Promise<OrderDetailDTO>;
  retrieveOrder(id: string): Promise<OrderDetailDTO>;
  /** 写商家备注（仅后台可见）；传 null/空串即清空。 */
  setMerchantNote(id: string, note: string | null): Promise<OrderDetailDTO>;
  listOrders(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }>;
  transition(id: string, to: OrderStatus, meta: { actor: Actor; reason?: string }): Promise<OrderDTO>;
  /** 创建退款申请单（买家申请或商家主动），落库为 pending。 */
  createRefundRequest(
    orderId: string,
    input: { amountMinor: bigint; reason: string; source: RefundRequestSource; customerId?: string | null },
  ): Promise<RefundRequestDTO>;
  /** 后台退款列表（按状态筛选，分页）。 */
  listRefundRequests(q: RefundRequestQuery): Promise<{ items: RefundRequestDTO[]; count: number }>;
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
