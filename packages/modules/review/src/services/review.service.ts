import { prefixedUlid } from "@mall/core";
import {
  alreadyReviewed,
  invalidRating,
  orderNotReviewable,
  productNotInOrder,
  reviewContentTooLong,
  reviewNotFound,
  reviewNotOrderOwner,
  reviewOrderNotFound,
} from "../errors.js";
import type {
  CreateReviewInput,
  IReviewModuleService,
  ListReviewsQuery,
  ReviewDTO,
  ReviewOrderPort,
  ReviewRepository,
  ReviewSummaryDTO,
} from "../types.js";

/** 评价内容上限：与淘宝 500 字一致，够写清楚又不至于变成小作文。 */
const MAX_CONTENT = 500;

/** 商家解释上限：短一些，它是回应不是第二篇评价。 */
const MAX_REPLY = 300;

/**
 * 订单「已收货」之后才能评价。
 *
 * 用 fulfilled 起：仓库里 delivered/completed 由后端逐步推进，
 * 只认 completed 会让大多数真实订单永远评不了（系统里没人手动点完成）。
 */
const REVIEWABLE_STATUSES = new Set(["fulfilled", "delivered", "completed"]);

export class ReviewService implements IReviewModuleService {
  constructor(
    private readonly repo: ReviewRepository,
    private readonly order: ReviewOrderPort,
  ) {}

  async createReview(input: CreateReviewInput): Promise<ReviewDTO> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw invalidRating();
    }
    const content = (input.content ?? "").trim();
    if (content.length > MAX_CONTENT) throw reviewContentTooLong(MAX_CONTENT);

    const order = await this.order.getOrder(input.orderId);
    if (!order) throw reviewOrderNotFound(input.orderId);
    // 只有买家自己能评：订单号可被猜到，归属必须服务端判
    if (order.customer_id !== input.customerId) throw reviewNotOrderOwner();
    if (!REVIEWABLE_STATUSES.has(order.status)) throw orderNotReviewable(order.status);

    const item = order.items.find((i) => i.product_id === input.productId);
    if (!item) throw productNotInOrder();

    // 幂等前置：同一单同一商品只能评一次（并发下由部分唯一索引兜底）
    const existing = await this.repo.findByOrderProduct(
      input.orderId,
      input.productId,
      input.customerId,
    );
    if (existing) throw alreadyReviewed();

    return this.repo.insert({
      id: prefixedUlid("rev"),
      productId: input.productId,
      // 商品名做快照：商品改名或下架后，后台与店面仍能读出「当时评的是哪件」
      productTitle: item.title,
      orderId: input.orderId,
      customerId: input.customerId,
      customerName: maskName(input.customerName),
      rating: input.rating,
      content,
    });
  }

  async listProductReviews(
    productId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number; summary: ReviewSummaryDTO }> {
    const [page, summary] = await Promise.all([
      this.repo.listByProduct(productId, q),
      this.repo.summaryByProduct(productId),
    ]);
    return { items: page.items, count: page.count, summary };
  }

  async summarizeProduct(productId: string): Promise<ReviewSummaryDTO> {
    return this.repo.summaryByProduct(productId);
  }

  async listReviews(q: ListReviewsQuery): Promise<{ items: ReviewDTO[]; count: number }> {
    return this.repo.list(q);
  }

  async listByOrder(orderId: string): Promise<ReviewDTO[]> {
    return this.repo.listByOrder(orderId);
  }

  async setVisible(id: string, visible: boolean): Promise<ReviewDTO> {
    const updated = await this.repo.setVisible(id, visible);
    if (!updated) throw reviewNotFound(id);
    return updated;
  }

  async reply(id: string, content: string): Promise<ReviewDTO> {
    const trimmed = content.trim();
    if (trimmed.length > MAX_REPLY) throw reviewContentTooLong(MAX_REPLY);
    const updated = await this.repo.setReply(id, trimmed.length > 0 ? trimmed : null);
    if (!updated) throw reviewNotFound(id);
    return updated;
  }
}

/**
 * 展示名脱敏：张** / t***。
 *
 * 评价是公开内容，顾客全名不该出现在任何人打开商品页都能看到的地方；
 * 后台需要真实身份时从订单查（订单有收货人）。
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "匿名顾客";
  const at = trimmed.indexOf("@");
  if (at >= 0) {
    // 邮箱：只留首字符，别暴露域名（域名能反推公司）
    return `${trimmed.slice(0, 1)}***`;
  }
  const first = [...trimmed][0] ?? "";
  return `${first}**`;
}
