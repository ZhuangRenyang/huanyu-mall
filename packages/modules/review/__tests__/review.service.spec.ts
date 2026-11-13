import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { ReviewService, maskName } from "../src/services/review.service.js";
import type {
  ListReviewsQuery,
  ReviewDTO,
  ReviewOrderPort,
  ReviewRepository,
  ReviewSummaryDTO,
} from "../src/types.js";

/** 内存仓储：行为对齐 Drizzle 实现（可见性过滤、软删、聚合）。 */
class InMemoryReviewRepository implements ReviewRepository {
  rows: ReviewDTO[] = [];

  async insert(input: {
    id: string;
    productId: string;
    productTitle: string;
    orderId: string;
    customerId: string;
    customerName: string;
    rating: number;
    content: string;
  }): Promise<ReviewDTO> {
    const dto: ReviewDTO = {
      id: input.id,
      product_id: input.productId,
      product_title: input.productTitle,
      order_id: input.orderId,
      customer_id: input.customerId,
      customer_name: input.customerName,
      rating: input.rating,
      content: input.content,
      is_visible: true,
      reply: null,
      replied_at: null,
      created_at: new Date(),
    };
    this.rows.push(dto);
    return dto;
  }

  async findById(id: string): Promise<ReviewDTO | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByOrderProduct(
    orderId: string,
    productId: string,
    customerId: string,
  ): Promise<ReviewDTO | null> {
    return (
      this.rows.find(
        (r) => r.order_id === orderId && r.product_id === productId && r.customer_id === customerId,
      ) ?? null
    );
  }

  async listByProduct(
    productId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number }> {
    const all = this.rows.filter((r) => r.product_id === productId && r.is_visible);
    return { items: all.slice(q.offset, q.offset + q.limit), count: all.length };
  }

  async summaryByProduct(productId: string): Promise<ReviewSummaryDTO> {
    const visible = this.rows.filter((r) => r.product_id === productId && r.is_visible);
    const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const r of visible) distribution[String(r.rating)] = (distribution[String(r.rating)] ?? 0) + 1;
    const count = visible.length;
    const sum = visible.reduce((s, r) => s + r.rating, 0);
    return { average: count ? Math.round((sum / count) * 10) / 10 : null, count, distribution };
  }

  async list(q: ListReviewsQuery): Promise<{ items: ReviewDTO[]; count: number }> {
    let all = [...this.rows];
    if (q.productId) all = all.filter((r) => r.product_id === q.productId);
    if (q.visible !== undefined) all = all.filter((r) => r.is_visible === q.visible);
    return { items: all.slice(q.offset, q.offset + q.limit), count: all.length };
  }

  async listByOrder(orderId: string): Promise<ReviewDTO[]> {
    return this.rows.filter((r) => r.order_id === orderId);
  }

  async listByCustomer(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number }> {
    // 与真实仓储同口径：只按顾客收敛，不含已软删的（假仓储里没有软删场景）
    const mine = this.rows
      .filter((r) => r.customer_id === customerId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { items: mine.slice(q.offset, q.offset + q.limit), count: mine.length };
  }

  async setVisible(id: string, visible: boolean): Promise<ReviewDTO | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.is_visible = visible;
    return row;
  }

  async setReply(id: string, reply: string | null): Promise<ReviewDTO | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.reply = reply;
    row.replied_at = reply ? new Date() : null;
    return row;
  }
}

type OrderFixture = {
  id: string;
  customer_id: string | null;
  status: string;
  items: Array<{ product_id: string; title: string }>;
};

function setup(order: OrderFixture | null = fulfilledOrder()) {
  const repo = new InMemoryReviewRepository();
  const port: ReviewOrderPort = { getOrder: async () => order };
  return { repo, service: new ReviewService(repo, port) };
}

function fulfilledOrder(over: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: "ord_1",
    customer_id: "cust_1",
    status: "fulfilled",
    items: [{ product_id: "prod_1", title: "无线静音鼠标" }],
    ...over,
  };
}

const baseInput = {
  orderId: "ord_1",
  productId: "prod_1",
  customerId: "cust_1",
  customerName: "张三",
  rating: 5,
  content: "手感不错",
};

describe("商品评价：提交", () => {
  it("已收货的订单可以评价，展示名脱敏后落库", async () => {
    const { service } = setup();
    const review = await service.createReview(baseInput);
    expect(review.rating).toBe(5);
    expect(review.customer_name).toBe("张**");
    expect(review.product_title).toBe("无线静音鼠标");
    expect(review.is_visible).toBe(true);
  });

  it("未收货的订单不能评价", async () => {
    const { service } = setup(fulfilledOrder({ status: "paid" }));
    await expect(service.createReview(baseInput)).rejects.toBeInstanceOf(DomainError);
  });

  it("别人的订单不能评价（订单号可被猜到，归属必须服务端判）", async () => {
    const { service } = setup(fulfilledOrder({ customer_id: "cust_other" }));
    await expect(service.createReview(baseInput)).rejects.toMatchObject({ code: 10003 });
  });

  it("商品不在订单里不能评价", async () => {
    const { service } = setup();
    await expect(service.createReview({ ...baseInput, productId: "prod_2" })).rejects.toMatchObject({
      code: 20002,
    });
  });

  it("一单一商品只能评一次", async () => {
    const { service } = setup();
    await service.createReview(baseInput);
    await expect(service.createReview({ ...baseInput, content: "再评一次" })).rejects.toMatchObject({
      code: 30002,
    });
  });

  it("评分越界 / 内容超长被拒", async () => {
    const { service } = setup();
    await expect(service.createReview({ ...baseInput, rating: 6 })).rejects.toMatchObject({ code: 20003 });
    await expect(service.createReview({ ...baseInput, rating: 0 })).rejects.toMatchObject({ code: 20003 });
    await expect(
      service.createReview({ ...baseInput, content: "字".repeat(501) }),
    ).rejects.toMatchObject({ code: 20004 });
  });

  it("不写内容的「默认好评」可以提交（content 为空串）", async () => {
    const { service } = setup();
    const review = await service.createReview({ ...baseInput, content: undefined });
    expect(review.content).toBe("");
  });
});

describe("商品评价：展示", () => {
  it("摘要给平均分（一位小数）、条数与星级分布", async () => {
    const { service, repo } = setup();
    await service.createReview({ ...baseInput, rating: 5 });
    // 第二条走仓储：同一订单同一商品不允许重复，这里模拟另一个买家的评价
    await repo.insert({
      id: "rev_x",
      productId: "prod_1",
      productTitle: "无线静音鼠标",
      orderId: "ord_2",
      customerId: "cust_2",
      customerName: "李**",
      rating: 2,
      content: "",
    });

    const summary = await service.summarizeProduct("prod_1");
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(3.5);
    expect(summary.distribution["5"]).toBe(1);
    expect(summary.distribution["2"]).toBe(1);
  });

  it("没有评价时 average 为 null（前端显示「暂无评价」而不是 0.0）", async () => {
    const { service } = setup();
    const summary = await service.summarizeProduct("prod_none");
    expect(summary.average).toBeNull();
    expect(summary.count).toBe(0);
  });

  it("隐藏后店面列表不再返回，但后台仍看得到", async () => {
    const { service } = setup();
    const review = await service.createReview(baseInput);

    await service.setVisible(review.id, false);
    const storeView = await service.listProductReviews("prod_1", { limit: 10, offset: 0 });
    expect(storeView.count).toBe(0);
    expect(storeView.summary.count).toBe(0);

    const adminView = await service.listReviews({ limit: 10, offset: 0, visible: false });
    expect(adminView.count).toBe(1);
  });

  it("商家解释可写可清空", async () => {
    const { service } = setup();
    const review = await service.createReview(baseInput);

    const replied = await service.reply(review.id, "感谢反馈，已改进静音微动");
    expect(replied.reply).toContain("感谢");
    expect(replied.replied_at).toBeTruthy();

    const cleared = await service.reply(review.id, "   ");
    expect(cleared.reply).toBeNull();
    expect(cleared.replied_at).toBeNull();
  });

  it("按订单查已评价商品（「我的订单」显示「已评价」）", async () => {
    const { service } = setup();
    await service.createReview(baseInput);
    const list = await service.listByOrder("ord_1");
    expect(list.map((r) => r.product_id)).toEqual(["prod_1"]);
  });
});

describe("脱敏", () => {
  it("中文名留首字、邮箱不暴露域名、空名给匿名", () => {
    expect(maskName("张三")).toBe("张**");
    expect(maskName("tom@example.com")).toBe("t***");
    expect(maskName("   ")).toBe("匿名顾客");
  });
});

describe("我的评价：只按顾客收敛（ADR-054）", () => {
  /** 造一条评价行，只指定关心的三个字段。 */
  function makeRow(p: { id: string; customer_id: string; product_id: string }): ReviewDTO {
    return {
      id: p.id,
      product_id: p.product_id,
      product_title: "无线静音鼠标",
      order_id: "ord_1",
      customer_id: p.customer_id,
      customer_name: "张**",
      rating: 5,
      content: "",
      is_visible: true,
      reply: null,
      replied_at: null,
      created_at: new Date(),
    };
  }

  it("别的顾客的评价不会出现在我的列表里", async () => {
    const repo = new InMemoryReviewRepository();
    const service = new ReviewService(repo, { getOrder: async () => null });
    repo.rows.push(
      makeRow({ id: "rev_a", customer_id: "cust_1", product_id: "prod_1" }),
      makeRow({ id: "rev_b", customer_id: "cust_2", product_id: "prod_2" }),
    );
    const res = await service.listMyReviews("cust_1", { limit: 20, offset: 0 });
    expect(res.count).toBe(1);
    expect(res.items[0]?.id).toBe("rev_a");
  });
});
