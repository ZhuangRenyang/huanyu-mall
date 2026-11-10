import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

async function withApp(fn: (app: Awaited<ReturnType<typeof buildApp>>, deps: ReturnType<typeof makeDeps>) => Promise<void>) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

describe("API routes（fastify.inject）", () => {
  it("1. GET /store/bootstrap 200 返回 channel/locale/币种/主题", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.code).toBe(0);
      expect(body.data.channel.slug).toBe("cn");
      expect(body.data.locale).toBe("zh-CN");
      expect(body.data.currencies).toContain("CNY");
      expect(body.data.theme).toBeDefined();
    });
  });

  it("2. products 列表 200 + 详情聚合（变体价格+库存）", async () => {
    await withApp(async (app) => {
      const list = await app.inject({ method: "GET", url: "/api/v1/store/products?limit=20&offset=0" });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.items).toHaveLength(1);

      const detail = await app.inject({ method: "GET", url: "/api/v1/store/products/tee" });
      expect(detail.statusCode).toBe(200);
      const d = detail.json().data;
      expect(d.variants[0].price.amount_minor).toBe(9900);
      expect(d.variants[0].inventory_status).toBe("in_stock");
      expect(d.variants[0].available_quantity).toBe(12);
      expect(d.images[0].url).toContain("/uploads/");
    });
  });

  it("3. 加购 → complete 201 返回 order（走 workflow）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/carts/cart_1/complete",
        headers: { "idempotency-key": "idem-1" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toBe("ord_1");
      expect(body.data.line_items).toHaveLength(1);
    });
  });

  it("3b. 一车一单幂等：同车第二次 complete 返回同一订单（200，不再走 workflow）", async () => {
    await withApp(async (app, deps) => {
      // 第一次下单成功 → workflow 运行 → 订单已存在（state.orderCreated 置位）
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/store/carts/cart_1/complete",
        headers: { "idempotency-key": "idem-b1" },
      });
      expect(first.statusCode).toBe(201);
      // 真实实现里 workflow 成功后会作废购物车并留下订单；这里模拟下单后的状态
      deps.services.order.listOrders = (async () => ({
        items: [
          {
            id: "ord_1",
            status: "pending",
            payment_status: "unpaid",
            email: "a@b.com",
            currency_code: "CNY",
            channel_id: "chn_cn",
            region_id: "reg_1",
            subtotal_minor: 9900n,
            shipping_minor: 800n,
            tax_minor: 0n,
            discount_minor: 0n,
            total_minor: 10700n,
            shipping_address: {},
            payment_collection_id: null,
            placed_at: new Date().toISOString(),
          },
        ],
        count: 1,
      })) as typeof deps.services.order.listOrders;

      // 同车再次 complete（即使幂等键不同）→ 返回同一订单，不产生第二笔
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/store/carts/cart_1/complete",
        headers: { "idempotency-key": "idem-b2" },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().data.id).toBe("ord_1");
    });
  });

  it("4. webhook 验签失败 401 且未落库；合法回调重复投递只处理一次", async () => {
    await withApp(async (app, deps) => {
      const payload = JSON.stringify({ id: "evt_1" });
      const bad = await app.inject({
        method: "POST",
        url: "/api/v1/store/webhooks/payment/pp_stripe",
        headers: { "stripe-signature": "bad", "content-type": "application/json" },
        payload,
      });
      expect(bad.statusCode).toBe(401);
      expect(deps.seen.size).toBe(0);

      const ok1 = await app.inject({
        method: "POST",
        url: "/api/v1/store/webhooks/payment/pp_stripe",
        headers: { "stripe-signature": "valid", "content-type": "application/json" },
        payload,
      });
      expect(ok1.statusCode).toBe(200);
      expect(ok1.json().data.duplicate).toBe(false);

      const ok2 = await app.inject({
        method: "POST",
        url: "/api/v1/store/webhooks/payment/pp_stripe",
        headers: { "stripe-signature": "valid", "content-type": "application/json" },
        payload,
      });
      expect(ok2.json().data.duplicate).toBe(true);
      expect(deps.seen.size).toBe(1);
    });
  });

  it("5. admin 登录 → 建商品 201；未带 JWT 401；staff 访问 settings 403", async () => {
    await withApp(async (app) => {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@x.com", password: "pw123456" },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().data.access_token).toBe("admin");

      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { title: "新品", handle: "new-product" },
      });
      expect(create.statusCode).toBe(201);
      expect(create.json().data.handle).toBe("new-product");

      const noAuth = await app.inject({ method: "GET", url: "/api/v1/admin/products" });
      expect(noAuth.statusCode).toBe(401);

      const staff = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: { authorization: "Bearer staff" } });
      expect(staff.statusCode).toBe(403);

      const admin = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: { authorization: "Bearer admin" } });
      expect(admin.statusCode).toBe(200);
    });
  });

  it("11. 授权会话 201 创建 payment → 扣款 200 变 captured（authorize/capture 闭环）", async () => {
    await withApp(async (app) => {
      const auth = await app.inject({
        method: "POST",
        url: "/api/v1/store/payment-sessions/paysess_1/authorize",
        headers: { "x-publishable-key": "cn" },
      });
      expect(auth.statusCode).toBe(201);
      expect(auth.json().data.status).toBe("authorized");
      expect(auth.json().data.id).toBe("pay_1");

      const cap = await app.inject({
        method: "POST",
        url: "/api/v1/store/payments/pay_1/capture",
        headers: { "x-publishable-key": "cn" },
        payload: { amount_minor: 19800, idempotency_key: "cap_e2e_1" },
      });
      expect(cap.statusCode).toBe(200);
      expect(cap.json().data.status).toBe("captured");
      expect(cap.json().data.amount_minor).toBe(19800);
    });
  });

  it("12. 扣款缺幂等键 → 400（幂等键必填）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/payments/pay_1/capture",
        headers: { "x-publishable-key": "cn" },
        payload: { amount_minor: 19800 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(20001);
    });
  });

  it("13. voucher 后台管理：建券(自动生成码)/列表/详情/启停/加码，全部 RBAC + 审计", async () => {
    await withApp(async (app, deps) => {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@x.com", password: "pw123456" },
      });
      expect(login.statusCode).toBe(200);

      // 未带 JWT → 401
      const noAuth = await app.inject({ method: "GET", url: "/api/v1/admin/promotions/vouchers" });
      expect(noAuth.statusCode).toBe(401);

      // staff → 403（无 settings 权限）
      const staff = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions/vouchers",
        headers: { authorization: "Bearer staff" },
      });
      expect(staff.statusCode).toBe(403);

      // 建券（不传 codes → 后端生成）
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { name: "满 100 减 20", discount_type: "fixed", discount_value: 2000, min_spent: 10000 },
      });
      expect(create.statusCode).toBe(201);
      const created = create.json().data;
      expect(created.id).toBe("vouch_1");
      expect(created.discount_value).toBe(2000);
      expect(created.codes).toHaveLength(1);
      expect(created.codes[0].code).toMatch(/^[0-9A-F]{12}$/);

      // 详情
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/promotions/vouchers/${created.id}`,
        headers: { authorization: "Bearer admin" },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.name).toBe("满 100 减 20");

      // 更新
      const update = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/promotions/vouchers/${created.id}`,
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { usage_limit: 100 },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().data.usage_limit).toBe(100);

      // 停用/启用
      const disable = await app.inject({
        method: "POST",
        url: `/api/v1/admin/promotions/vouchers/${created.id}/disable`,
        headers: { authorization: "Bearer admin" },
      });
      expect(disable.statusCode).toBe(200);
      expect(disable.json().data.status).toBe("disabled");
      const enable = await app.inject({
        method: "POST",
        url: `/api/v1/admin/promotions/vouchers/${created.id}/enable`,
        headers: { authorization: "Bearer admin" },
      });
      expect(enable.statusCode).toBe(200);
      expect(enable.json().data.status).toBe("active");

      // 加码
      const addCodes = await app.inject({
        method: "POST",
        url: `/api/v1/admin/promotions/vouchers/${created.id}/codes`,
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { codes: ["SAVE20"] },
      });
      expect(addCodes.statusCode).toBe(201);

      // 列表券码
      const listCodes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/promotions/vouchers/${created.id}/codes`,
        headers: { authorization: "Bearer admin" },
      });
      expect(listCodes.statusCode).toBe(200);
      expect(listCodes.json().data.items.length).toBe(2);

      // 审计留痕：voucher.create 已记录
      expect(deps.auditRepo.rows.some((r) => r.action === "voucher.create")).toBe(true);
    });
  });

  it("14. 店面输码：PUT voucher-codes 返回含 voucher_codes 的购物车", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/store/carts/cart_1/voucher-codes",
        headers: { "content-type": "application/json" },
        payload: { codes: ["SAVE20"] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.voucher_codes).toEqual(["SAVE20"]);
    });
  });

  it("6. limit>100 → 400；错误体含 {code,message}", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products?limit=200&offset=0" });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe(20001);
      expect(typeof body.message).toBe("string");
    });
  });

  it("7. admin 建变体 201 / 改变体 200 / 按币种设价 200", async () => {
    await withApp(async (app) => {
      const createVariant = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/prod_1/variants",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { sku: "NEW-S", title: "新规格" },
      });
      expect(createVariant.statusCode).toBe(201);
      expect(createVariant.json().data.sku).toBe("NEW-S");

      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/variants/var_1",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { title: "改名" },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.title).toBe("改名");

      const prices = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/variants/var_1/prices",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { prices: [{ currency_code: "CNY", amount_minor: 10000 }] },
      });
      expect(prices.statusCode).toBe(200);
      expect(prices.json().data.price_set_id).toBe("pset_1");
    });
  });

  it("8. 客户列表 200 分页 / 库存列表 200 / 按 level 调库存 200", async () => {
    await withApp(async (app) => {
      const cust = await app.inject({ method: "GET", url: "/api/v1/admin/customers?limit=20&offset=0", headers: { authorization: "Bearer admin" } });
      expect(cust.statusCode).toBe(200);
      expect(cust.json().data.items).toHaveLength(1);
      expect(cust.json().data.count).toBe(1);

      const items = await app.inject({ method: "GET", url: "/api/v1/admin/inventory-items", headers: { authorization: "Bearer admin" } });
      expect(items.statusCode).toBe(200);
      expect(items.json().data.items).toHaveLength(1);

      const adjust = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/inventory-levels/invlvl_1",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { delta: 5, reason: "补货" },
      });
      expect(adjust.statusCode).toBe(200);
      expect(adjust.json().data.stocked_quantity).toBe(15);
    });
  });

  it("9. theme 写 → bootstrap 读到新主色", async () => {
    await withApp(async (app) => {
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: { primary_color: "#000000" },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.theme.primary_color).toBe("#000000");

      const bootstrap = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(bootstrap.json().data.theme.primary_color).toBe("#000000");
    });
  });

  it("10. provider 配置写入 → GET 回显为掩码（末 4 位，绝不回明文）", async () => {
    await withApp(async (app) => {
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/payment-providers/pp_wechat",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: {
          options: { mchid: "1912345678", apiV3Key: "0123456789abcdef0123456789abcdef" },
          enabled_channels: ["chn_cn"],
        },
      });
      expect(put.statusCode).toBe(200);

      const get = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/payment-providers/pp_wechat",
        headers: { authorization: "Bearer admin" },
      });
      expect(get.statusCode).toBe(200);
      const masked = get.json().data.options_masked;
      expect(masked.mchid).toBe("****5678");
      expect(masked.mchid).not.toBe("1912345678");
      expect(masked.apiV3Key).toBe("****cdef");
    });
  });
});
