/**
 * 业务模块的测试替身（mock services）——支付侧：支付集合 / 会话 / 授权 / 扣款 / 回调 / 商户配置。
 */
import { errors } from "@mall/core";
import type { FakeServicesState } from "./fake-services-state.js";

export function makeFakePaymentServices(state: FakeServicesState) {
  const { seen, providerConfig } = state;
  return {
    payment: {
      listEnabledProviders: async () => [
        {
          identifier: "pp_fake",
          label: "Fake",
          capabilities: {},
          supportedCurrencies: ["CNY"],
        },
      ],
      createPaymentCollection: async () => ({ id: "paycol_1" }),
      findCollectionByOrderId: async () => null,
      findCollectionById: async () => null,
      /** 订单详情用它判断「顾客用什么付的」；未付款的订单返回 null。 */
      findPaymentByOrderId: async () =>
        state.orderCreated
          ? {
              id: "pay_1",
              payment_collection_id: "paycol_1",
              session_id: "paysess_1",
              amount_minor: 19800n,
              currency_code: "CNY",
              status: "captured",
              provider_id: "pp_fake",
              provider_reference: "ref_1",
              captured_at: "2026-11-12T10:00:00.000Z",
            }
          : null,
      createSession: async () => ({ id: "paysess_1" }),
      authorizeSession: async (sessionId: string) => ({
        id: "pay_1",
        payment_collection_id: "paycol_1",
        session_id: sessionId,
        status: "authorized",
        amount_minor: 19800n,
        currency_code: "CNY",
        provider_id: "pp_fake",
      }),
      capturePayment: async (paymentId: string, amountMinor: bigint) => ({
        id: paymentId,
        payment_collection_id: "paycol_1",
        session_id: "paysess_1",
        status: "captured",
        amount_minor: amountMinor,
        currency_code: "CNY",
        provider_id: "pp_fake",
      }),
      handleProviderWebhook: async (
        providerId: string,
        raw: { headers: Record<string, string>; rawBody: string },
      ) => {
        const sig = raw.headers["stripe-signature"] ?? "";
        if (!sig.includes("valid")) throw errors.webhookSignatureInvalid();
        const body = JSON.parse(raw.rawBody) as { id: string };
        const key = `${providerId}:${body.id}`;
        const duplicate = seen.has(key);
        if (!duplicate) seen.add(key);
        return { eventId: body.id, action: "captured", duplicate };
      },
      configureProvider: async (input: {
        identifier: string;
        options: Record<string, unknown>;
      }) => {
        const masked: Record<string, string> = {};
        for (const [k, v] of Object.entries(input.options)) {
          const s = String(v);
          masked[k] = s.length > 4 ? `****${s.slice(-4)}` : "****";
        }
        providerConfig.set(input.identifier, masked);
        return {
          identifier: input.identifier,
          label: input.identifier,
          is_enabled: true,
          options_masked: masked,
        };
      },
      listProviderConfigs: async () => [
        { identifier: "alipay", label: "支付宝", is_enabled: true, options_masked: { app_id: "****1234" } },
        { identifier: "wechat", label: "微信支付", is_enabled: false, options_masked: {} },
      ],
      getProviderConfig: async (identifier: string) => {
        const masked = providerConfig.get(identifier) ?? {};
        return {
          identifier,
          label: identifier,
          is_enabled: true,
          options_masked: masked,
        };
      },
    },
  };
}
