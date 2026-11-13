import { errors } from "@mall/core";
import type { FakeServicesState } from "./fake-services-state.js";

/**
 * 评价假服务（ADR-042）。
 *
 * 只保证路由层契约：401 / 403 / 400 / 201 与字段形状。
 * 「订单状态、商品是否在订单里、一单一评」这些规则在 @mall/review 的模块单测里守着。
 */
export function makeFakeReviewServices(state: FakeServicesState) {
  const reviews: Array<{
    id: string;
    product_id: string;
    product_title: string;
    order_id: string;
    customer_id: string;
    customer_name: string;
    rating: number;
    content: string;
    is_visible: boolean;
    reply: string | null;
    replied_at: Date | null;
    created_at: Date;
  }> = [];

  return {
    review: {
      createReview: async (input: {
        orderId: string;
        productId: string;
        customerId: string;
        customerName: string;
        rating: number;
        content?: string;
      }) => {
        if (input.orderId !== "ord_1") throw errors.notFound(`订单不存在：${input.orderId}`);
        if (input.customerId !== "cust_1") {
          throw errors.forbidden("只能评价自己买过的商品");
        }
        // 默认订单可评；测试可把它关掉模拟「还没收货」
        if (state.orderReviewable === false) {
          throw errors.validation("订单当前状态不能评价，确认收货后再来");
        }
        if (reviews.some((r) => r.product_id === input.productId)) {
          throw errors.validation("这笔订单的这个商品已经评价过了");
        }
        const review = {
          id: `rev_${reviews.length + 1}`,
          product_id: input.productId,
          product_title: "无线静音鼠标",
          order_id: input.orderId,
          customer_id: input.customerId,
          customer_name: `${input.customerName.slice(0, 1)}**`,
          rating: input.rating,
          content: input.content ?? "",
          is_visible: true,
          reply: null,
          replied_at: null,
          created_at: new Date(),
        };
        reviews.push(review);
        return review;
      },
      listProductReviews: async (productId: string) => {
        const visible = reviews.filter((r) => r.product_id === productId && r.is_visible);
        return {
          items: visible,
          count: visible.length,
          summary: {
            average: visible.length
              ? Math.round((visible.reduce((s, r) => s + r.rating, 0) / visible.length) * 10) / 10
              : null,
            count: visible.length,
            distribution: {},
          },
        };
      },
      summarizeProduct: async () => ({ average: null, count: 0, distribution: {} }),
      listReviews: async () => ({ items: reviews, count: reviews.length }),
      listByOrder: async (orderId: string) => reviews.filter((r) => r.order_id === orderId),
      /*
       * 我的评价：按传入的 customerId 过滤（路由从 token 取，不接受 query 覆盖）。
       * 含被隐藏的评价 —— 顾客要能看到「这条没在商品页展示」。
       */
      listMyReviews: async (customerId: string) => {
        const mine = reviews.filter((r) => r.customer_id === customerId);
        return { items: mine, count: mine.length };
      },
      setVisible: async (id: string, visible: boolean) => {
        const row = reviews.find((r) => r.id === id);
        if (!row) throw errors.notFound(`评价不存在：${id}`);
        row.is_visible = visible;
        return row;
      },
      reply: async (id: string, content: string) => {
        const row = reviews.find((r) => r.id === id);
        if (!row) throw errors.notFound(`评价不存在：${id}`);
        row.reply = content.trim().length > 0 ? content.trim() : null;
        row.replied_at = row.reply ? new Date() : null;
        return row;
      },
    },
  };
}
