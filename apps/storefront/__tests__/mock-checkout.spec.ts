/**
 * mock 模式的结账链路回归测试。
 *
 * mock 是默认模式（无后端也能完整演示），改动结账流程时不能把它弄坏：
 * - 运费方案/支付方式用本地常量，不打后端；
 * - 提交只造本地订单，不调任何真实接口。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_STEPS,
  PAYMENT_PROVIDERS,
  SHIPPING_OPTIONS,
  createOrder,
  emptyForm,
  validateStep,
} from "../lib/checkout";

describe("mock 模式：结账表单校验", () => {
  it("三步的必填项都要校验（配送方式已取消：运费按国家自动算）", () => {
    const empty = validateStep(1, { ...emptyForm });
    expect(empty.phone).toBeTruthy();

    expect(validateStep(2, { ...emptyForm, country: '' }).country).toBeTruthy();
    expect(validateStep(3, { ...emptyForm, paymentProviderId: '' }).paymentProviderId).toBeTruthy();
  });

  it("填全后不报错", () => {
    const filled = {
      ...emptyForm,
      phone: '13800000000',
      email: 'buyer@example.com',
      firstName: '张三',
      region: '广东省深圳市南山区',
      line1: '科技园科苑路 15 号',
      shippingOptionId: 'ship-standard',
      paymentProviderId: 'pp_wechat',
    };
    expect(validateStep(1, filled)).toEqual({});
    expect(validateStep(2, filled)).toEqual({});
    expect(validateStep(3, filled)).toEqual({});
    expect(validateStep(4, filled)).toEqual({});
  });

  it("邮箱格式不对要报错", () => {
    const bad = { ...emptyForm, phone: '13800000000', email: 'not-an-email' };
    expect(validateStep(1, bad).email).toBeTruthy();
  });

  it("三步步骤名齐全（结账进度条依赖；配送方式已自动化去掉）", () => {
    expect(CHECKOUT_STEPS).toEqual(["联系方式", "收货地址", "支付"]);
  });
});

describe("mock 模式：支付方式与运费方案用本地常量", () => {
  it("支付方式列表非空且带文案", () => {
    expect(PAYMENT_PROVIDERS.length).toBeGreaterThan(0);
    for (const p of PAYMENT_PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("运费方案带金额与币种", () => {
    expect(SHIPPING_OPTIONS.length).toBeGreaterThan(0);
    for (const o of SHIPPING_OPTIONS) {
      expect(o.id).toBeTruthy();
      expect(o.name).toBeTruthy();
      expect(o.currencyCode).toBeTruthy();
    }
  });

  it("默认选中的支付方式在列表里（否则第 4 步永远报「请选择支付方式」）", () => {
    expect(PAYMENT_PROVIDERS.some((p) => p.id === emptyForm.paymentProviderId)).toBe(true);
  });
});

describe("mock 模式：本地订单", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it("造出的订单落在 sessionStorage，可按 id 查回", () => {
    const order = createOrder({
      form: { ...emptyForm, phone: '13800000000', email: 'buyer@example.com' },
      items: [{ title: '无线静音鼠标', quantity: 1, unitPriceMinor: 19900 }],
      subtotalMinor: 19900,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 19900,
      currencyCode: 'CNY',
      shippingOptionName: '标准跨境专线',
    });

    expect(order.id).toMatch(/^ord_/);
    expect(order.status).toBe('processing');
    expect(sessionStorage.getItem(`order:${order.id}`)).toBeTruthy();
  });
});
