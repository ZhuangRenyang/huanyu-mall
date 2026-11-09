import type { AbstractPaymentProvider } from "./abstract.js";
import { FakePaymentProvider } from "./fake.js";
import { WechatPaymentProvider } from "./wechat.js";
import { AlipayPaymentProvider } from "./alipay.js";
import { StripePaymentProvider } from "./stripe.js";
import { PaypalPaymentProvider } from "./paypal.js";
import type { PaymentProviderDescriptor } from "./types.js";

type Ctor = new (config: Record<string, unknown>) => AbstractPaymentProvider;
interface Registration {
  descriptor: PaymentProviderDescriptor;
  ctor: Ctor;
}

/** 编译期声明四家沙箱 Provider + Fake 兜底（ADR-008：声明不实例化、不触网）。 */
const REGISTRY: Record<string, Registration> = {
  pp_fake: {
    descriptor: {
      identifier: "pp_fake",
      label: "Fake 兜底",
      capabilities: { webhook: true, partialRefund: false, authorizeThenCapture: true, qrFlow: true, redirectFlow: false },
      supportedCurrencies: ["CNY", "USD", "EUR", "HKD"],
    },
    ctor: FakePaymentProvider,
  },
  pp_wechat: {
    descriptor: {
      identifier: "pp_wechat",
      label: "微信支付",
      capabilities: { webhook: true, partialRefund: false, authorizeThenCapture: false, qrFlow: true, redirectFlow: false },
      supportedCurrencies: ["CNY"],
    },
    ctor: WechatPaymentProvider,
  },
  pp_alipay: {
    descriptor: {
      identifier: "pp_alipay",
      label: "支付宝",
      /*
       * partialRefund: true —— 退款接口 alipay.trade.refund 按 refund_amount 传金额，支持部分退款。
       * authorizeThenCapture: false —— 支付宝是即时到账（TRADE_SUCCESS 即到账），
       *   没有 Stripe/PayPal 那种「先授权再捕获」的两阶段，Provider 内部用查单确认代替。
       * qrFlow: false —— 当前实现走电脑/手机网站支付（跳转收银台），未做当面付（precreate）。
       */
      capabilities: { webhook: true, partialRefund: true, authorizeThenCapture: false, qrFlow: false, redirectFlow: true },
      supportedCurrencies: ["CNY"],
    },
    ctor: AlipayPaymentProvider,
  },
  pp_stripe: {
    descriptor: {
      identifier: "pp_stripe",
      label: "Stripe",
      capabilities: { webhook: true, partialRefund: false, authorizeThenCapture: true, qrFlow: false, redirectFlow: false },
      supportedCurrencies: ["USD", "EUR", "HKD"],
    },
    ctor: StripePaymentProvider,
  },
  pp_paypal: {
    descriptor: {
      identifier: "pp_paypal",
      label: "PayPal",
      /*
       * partialRefund: true —— PayPal 的退款接口按 capture 维度、可传 amount，
       * 实现里用 `fromMinor(amountMinor)` 传主单位字符串，支持部分退款。
       * supportedCurrencies 只是**内部支持范围的子集**：实际可用币种由 PayPal
       * 账户所在地区决定，后台启用时以 PayPal 侧为准。
       */
      capabilities: { webhook: true, partialRefund: true, authorizeThenCapture: true, qrFlow: false, redirectFlow: true },
      supportedCurrencies: ["USD", "EUR", "GBP", "HKD", "JPY", "AUD", "CAD", "SGD"],
    },
    ctor: PaypalPaymentProvider,
  },
};

export class ProviderRegistry {
  descriptors(): PaymentProviderDescriptor[] {
    return Object.values(REGISTRY).map((r) => r.descriptor);
  }

  descriptor(identifier: string): PaymentProviderDescriptor | null {
    return REGISTRY[identifier]?.descriptor ?? null;
  }

  /** 按需实例化：拿到解密后的配置才加载，构造函数不触网。 */
  load(identifier: string, config: Record<string, unknown>): AbstractPaymentProvider {
    const reg = REGISTRY[identifier];
    if (!reg) throw new Error(`Unknown payment provider: ${identifier}`);
    return new reg.ctor(config);
  }
}
