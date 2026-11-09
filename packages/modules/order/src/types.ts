/** M05 Order DTO 与契约（对齐架构 §2.1）。K4：一期只开全额退款。 */

export type OrderStatus =
  | "pending"
  | "awaiting_payment"
  | "paid"
  | "fulfilled"
  | "delivered"
  | "completed"
  | "canceled"
  | "refunded";

export type PaymentStatus = "unpaid" | "authorized" | "captured" | "refunded";
export type Actor = "customer" | "admin" | "system" | "workflow";

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

export interface OrderDetailDTO extends OrderDTO {
  items: OrderLineItemDTO[];
  shipping_method: OrderShippingMethodDTO | null;
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
  discountMinor?: bigint;
  paymentCollectionId?: string | null;
}

export interface RefundRequestDTO {
  orderId: string;
  amountMinor: bigint;
  currencyCode: string;
  reason: string;
}

export interface OrderQuery {
  limit?: number;
  offset?: number;
  status?: OrderStatus;
  /** 按购物车反查订单（支付侧复用 workflow 建好的支付集合时用）。 */
  cartId?: string;
}

export interface OrderRepository {
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
  listOrders(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }>;
  transition(id: string, to: OrderStatus, meta: { actor: Actor; reason?: string }): Promise<OrderDTO>;
  createRefundRequest(
    orderId: string,
    input: { amountMinor: bigint; reason: string },
  ): Promise<RefundRequestDTO>;
  markRefundSettled(orderId: string, refundRequestId: string): Promise<OrderDTO>;
  cancelOrder(id: string): Promise<void>;
}
