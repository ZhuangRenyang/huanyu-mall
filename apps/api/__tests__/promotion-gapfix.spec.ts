import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

describe("二期促销后端缺口（promotion admin + discounts 透出）", () => {
  it("1. promotion 后台管理：建(含规则)/列表(过滤)/详情/更新/启停/加规则/删规则/删除，RBAC + 审计", async () => {
    await withApp(async (app, deps) => {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@x.com", password: "pw123456" },
      });
      expect(login.statusCode).toBe(200);

      // 未带 JWT → 401
      const noAuth = await app.inject({ method: "GET", url: "/api/v1/admin/promotions" });
      expect(noAuth.statusCode).toBe(401);

      // staff → 403（无 settings 权限）
      const staff = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions",
        headers: { authorization: "Bearer staff" },
      });
      expect(staff.statusCode).toBe(403);

      // 建促销（order 类型 + 附一条 percentage 规则）
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: {
          name: "全场 9 折",
          type: "order",
          is_automatic: true,
          rules: [{ reward_type: "percentage", reward_value: 1000, allocation: "across" }],
        },
      });
      expect(create.statusCode).toBe(201);
      const created = create.json().data;
      expect(created.id).toBe("promo_1");
      expect(created.type).toBe("order");
      expect(created.status).toBe("draft");
      expect(created.rules).toHaveLength(1);
      expect(created.rules[0].reward_type).toBe("percentage");
      expect(created.rules[0].reward_value).toBe(1000);

      // 详情（含规则）
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/promotions/${created.id}`,
        headers: { authorization: "Bearer admin" },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.name).toBe("全场 9 折");
      expect(detail.json().data.rules).toHaveLength(1);

      // 更新
      const update = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/promotions/${created.id}`,
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { name: "全场 8 折", usage_limit: 500 },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().data.name).toBe("全场 8 折");
      expect(update.json().data.usage_limit).toBe(500);

      // 启用（status → active）
      const activate = await app.inject({
        method: "POST",
        url: `/api/v1/admin/promotions/${created.id}/activate`,
        headers: { authorization: "Bearer admin" },
      });
      expect(activate.statusCode).toBe(200);
      expect(activate.json().data.status).toBe("active");

      // 停用（status → inactive，即时生效）
      const deactivate = await app.inject({
        method: "POST",
        url: `/api/v1/admin/promotions/${created.id}/deactivate`,
        headers: { authorization: "Bearer admin" },
      });
      expect(deactivate.statusCode).toBe(200);
      expect(deactivate.json().data.status).toBe("inactive");

      // 加规则
      const addRule = await app.inject({
        method: "POST",
        url: `/api/v1/admin/promotions/${created.id}/rules`,
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { reward_type: "fixed", reward_value: 500, allocation: "each" },
      });
      expect(addRule.statusCode).toBe(201);
      const ruleId = addRule.json().data.id;
      expect(ruleId).toBe("prorul_2");
      expect(addRule.json().data.reward_value).toBe(500);

      // 删规则
      const delRule = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/promotions/rules/${ruleId}`,
        headers: { authorization: "Bearer admin" },
      });
      expect(delRule.statusCode).toBe(204);

      // 列表 + type 过滤（创建的是 order，过滤 catalogue 应为空）
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions?limit=20&offset=0",
        headers: { authorization: "Bearer admin" },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.count).toBe(1);

      const listFiltered = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions?limit=20&offset=0&type=catalogue",
        headers: { authorization: "Bearer admin" },
      });
      expect(listFiltered.statusCode).toBe(200);
      expect(listFiltered.json().data.count).toBe(0);

      // 删除（软删）
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/promotions/${created.id}`,
        headers: { authorization: "Bearer admin" },
      });
      expect(del.statusCode).toBe(204);

      // 审计留痕
      expect(deps.auditRepo.rows.some((r) => r.action === "promotion.create")).toBe(true);
      expect(deps.auditRepo.rows.some((r) => r.action === "promotion.deactivate")).toBe(true);
      expect(deps.auditRepo.rows.some((r) => r.action === "promotion_rule.create")).toBe(true);
    });
  });

  it("2. store 购物车 GET 透出 discounts 明细（优惠券/礼品卡逐项金额）", async () => {
    await withApp(async (app, deps) => {
      deps.services.cart.retrieveCart = (async () => ({
        id: "cart_1",
        channel_id: "chn_cn",
        region_id: "reg_1",
        currency_code: "CNY",
        customer_id: null,
        email: "a@b.com",
        status: "open",
        voucher_codes: ["SAVE20"],
        gift_card_codes: ["GC-ABC"],
        items: [
          {
            id: "cli_1",
            cart_id: "cart_1",
            variant_id: "var_1",
            product_id: "prod_1",
            title: "T恤",
            quantity: 1,
            unit_price_minor: 9900n,
            currency_code: "CNY",
            discount_minor: 0n,
          },
        ],
        shipping_method: null,
        totals: {
          subtotal_minor: 9900n,
          shipping_minor: 0n,
          tax_minor: 0n,
          total_minor: 2400n,
          discount_minor: 7500n,
        },
        discounts: [
          { type: "voucher", promotion_id: "vouch_1", code: "SAVE20", amount_minor: 2000n },
          { type: "gift_card", promotion_id: "gcard_1", code: "GC-ABC", amount_minor: 5000n },
          { type: "order", promotion_id: "promo_1", code: null, amount_minor: 500n },
        ],
      })) as typeof deps.services.cart.retrieveCart;

      const res = await app.inject({ method: "GET", url: "/api/v1/store/carts/cart_1" });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.discounts).toHaveLength(3);
      expect(data.discounts[0]).toEqual({
        type: "voucher",
        promotion_id: "vouch_1",
        code: "SAVE20",
        amount_minor: 2000,
      });
      expect(data.discounts[1]).toEqual({
        type: "gift_card",
        promotion_id: "gcard_1",
        code: "GC-ABC",
        amount_minor: 5000,
      });
      expect(data.discounts[2].type).toBe("order");
      expect(data.discounts[2].code).toBeNull();
    });
  });

  it("3. 资金安全：百分比折扣不得超过 100%（优惠券/促销规则/更新三处都拦）", async () => {
    await withApp(async (app) => {
      const auth = { authorization: "Bearer admin", "content-type": "application/json" };

      // 建券：150% → 400
      const badVoucher = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: { name: "超额券", discount_type: "percentage", discount_value: 15000 },
      });
      expect(badVoucher.statusCode).toBe(400);

      // 建券：100% 合法
      const okVoucher = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: { name: "满减券", discount_type: "percentage", discount_value: 10000, codes: ["MAX100"] },
      });
      expect(okVoucher.statusCode).toBe(201);
      const voucherId = okVoucher.json().data.id;

      // 更新：只改 value 不改 type，仍按现有 percentage 卡上限 → 400
      const badUpdate = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/promotions/vouchers/${voucherId}`,
        headers: auth,
        payload: { discount_value: 20000 },
      });
      expect(badUpdate.statusCode).toBe(400);

      // 促销规则：120% → 400
      const badRule = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions",
        headers: auth,
        payload: {
          name: "超额促销",
          type: "order",
          rules: [{ reward_type: "percentage", reward_value: 12000 }],
        },
      });
      expect(badRule.statusCode).toBe(400);

      // fixed 类型不受百分比上限约束（金额封顶由 computeDiscounts 负责）
      const okFixed = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions",
        headers: auth,
        payload: { name: "满 1000 减 500", type: "order", rules: [{ reward_type: "fixed", reward_value: 50000 }] },
      });
      expect(okFixed.statusCode).toBe(201);
    });
  });
});
