/** 商品评价（ADR-042）对外契约。 */

export interface ReviewDTO {
  id: string;
  product_id: string;
  /** 建单时的商品名快照（商品改名后评价仍可读）。 */
  product_title: string;
  order_id: string;
  customer_id: string;
  /** 已脱敏的展示名（如「张**」）。 */
  customer_name: string;
  /** 1..5。 */
  rating: number;
  /** 允许为空：点了星级不写内容的「默认好评」。 */
  content: string;
  is_visible: boolean;
  /** 商家解释。 */
  reply: string | null;
  replied_at: Date | null;
  created_at: Date;
}

export interface ReviewSummaryDTO {
  /** 平均分（一位小数）；无评价为 null，前端显示「暂无评价」而不是 0.0。 */
  average: number | null;
  count: number;
  /** 各星级条数（键 1..5），详情页画分布用。 */
  distribution: Record<string, number>;
}

/**
 * 订单端口：评价必须挂在「买过且已收货」的订单上。
 *
 * 用端口而不是直接依赖 order 模块：模块图里 review 不新增依赖边，
 * 适配器由组合根（apps/api）注入，测试里给内存实现即可。
 */
export interface ReviewOrderPort {
  getOrder(orderId: string): Promise<{
    id: string;
    customer_id: string | null;
    status: string;
    items: Array<{ product_id: string; title: string }>;
  } | null>;
}

export interface CreateReviewInput {
  orderId: string;
  productId: string;
  customerId: string;
  /** 顾客展示名（服务层负责脱敏后落库）。 */
  customerName: string;
  /** 1..5。 */
  rating: number;
  content?: string;
}

export interface ListReviewsQuery {
  limit: number;
  offset: number;
  /** 只看某个商品。 */
  productId?: string;
  /** true = 只看已隐藏，false = 只看展示中，undefined = 全部（后台用）。 */
  visible?: boolean;
}

export interface IReviewModuleService {
  /** 提交评价：校验归属、订单已收货、商品在订单里、一单一商品一条。 */
  createReview(input: CreateReviewInput): Promise<ReviewDTO>;
  /** 店面：某商品的可见评价 + 评分摘要。 */
  listProductReviews(
    productId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number; summary: ReviewSummaryDTO }>;
  /** 店面：单个商品的评分摘要（商品卡/详情页头部）。 */
  summarizeProduct(productId: string): Promise<ReviewSummaryDTO>;
  /** 后台：全部评价（含隐藏）。 */
  listReviews(q: ListReviewsQuery): Promise<{ items: ReviewDTO[]; count: number }>;
  /** 某订单已提交的评价（「我的订单」据此显示「已评价」）。 */
  listByOrder(orderId: string): Promise<ReviewDTO[]>;
  /**
   * 顾客自己写过的评价（「我的评价」，ADR-054）。
   * 含被商家隐藏的（is_visible=false）—— 顾客有权知道自己的评价没被展示。
   */
  listMyReviews(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number }>;
  setVisible(id: string, visible: boolean): Promise<ReviewDTO>;
  /** 商家解释；传空串 = 清除解释。 */
  reply(id: string, content: string): Promise<ReviewDTO>;
}

export interface ReviewRepository {
  insert(input: {
    id: string;
    productId: string;
    productTitle: string;
    orderId: string;
    customerId: string;
    customerName: string;
    rating: number;
    content: string;
  }): Promise<ReviewDTO>;
  findById(id: string): Promise<ReviewDTO | null>;
  /** 幂等/去重：同一订单同一商品同一顾客。 */
  findByOrderProduct(orderId: string, productId: string, customerId: string): Promise<ReviewDTO | null>;
  /** 店面列表：只返回 is_visible（SQL 侧过滤）。 */
  listByProduct(productId: string, q: { limit: number; offset: number }): Promise<{ items: ReviewDTO[]; count: number }>;
  /** 评分聚合：一次 GROUP BY（avg + count + 各星级条数）。 */
  summaryByProduct(productId: string): Promise<ReviewSummaryDTO>;
  list(q: ListReviewsQuery): Promise<{ items: ReviewDTO[]; count: number }>;
  listByOrder(orderId: string): Promise<ReviewDTO[]>;
  listByCustomer(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number }>;
  setVisible(id: string, visible: boolean): Promise<ReviewDTO | null>;
  setReply(id: string, reply: string | null): Promise<ReviewDTO | null>;
}
