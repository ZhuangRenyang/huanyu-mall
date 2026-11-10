'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button, IconButton, Skeleton, formatMoney } from '@mall/ui';
import { useCart } from '@/lib/cart-store';
import { getApiMode } from '@/lib/api';
import { getLiveCartId, markCartOrdered, prepareCartForOrder, withLiveCartLock } from '@/lib/live-cart';
import {
  applyPromoCodesToCart,
  buildDiscountLines,
  fetchCartPromo,
  setCartGiftCardCodes,
  setCartVoucherCodes,
  EMPTY_PROMO,
  type CartPromoView,
} from '@/lib/promo';
import {
  CHECKOUT_STEPS,
  PAYMENT_PROVIDERS,
  SHIPPING_OPTIONS,
  createOrder,
  cartFingerprint,
  describeError,
  emptyForm,
  loadLivePaymentProviders,
  loadLiveShippingOptions,
  resolvePaymentLaunch,
  savePendingPayment,
  submitLiveCheckout,
  validateStep,
  type CheckoutErrors,
  type CheckoutForm,
  type PaymentProviderView,
  type ShippingOptionView,
} from '@/lib/checkout';
import { CheckoutStepper } from './checkout-stepper';
import { OrderSummary } from './order-summary';
import { ContactStep } from './contact-step';
import { AddressStep } from './address-step';
import { ShippingStep } from './shipping-step';
import { PaymentStep } from './payment-step';
import { PromoCodes } from './promo-codes';

const DRAFT_KEY = 'checkout:draft';

export function CheckoutFlow({ locale, channel }: { locale: string; channel: string }) {
  const router = useRouter();
  const { items, subtotal, hydrated } = useCart();
  const live = getApiMode() === 'live';

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CheckoutForm>(emptyForm);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [shippingOptions, setShippingOptions] = useState<ShippingOptionView[]>(
    live ? [] : SHIPPING_OPTIONS,
  );
  const [paymentProviders, setPaymentProviders] = useState<PaymentProviderView[]>(
    live ? [] : PAYMENT_PROVIDERS,
  );
  const [optionsLoading, setOptionsLoading] = useState(live);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // live 模式：优惠码 / 礼品卡快照（金额一律后端算好，前端只透传展示）。
  const [promo, setPromo] = useState<CartPromoView>(EMPTY_PROMO);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  // 进入结账页时拉取已输码状态（刷新不丢码，折扣以后端为准）。
  useEffect(() => {
    if (!live) {
      setPromo(EMPTY_PROMO);
      return;
    }
    const cartId = getLiveCartId();
    if (!cartId) return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await fetchCartPromo(cartId);
        if (!cancelled) setPromo(view);
      } catch {
        /* 拉取失败保持空态，输码时会重新设置 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);

  /** 调 store 接口设置码并回填后端算好的折扣（只传码凭证）。 */
  const mutatePromo = useCallback(async (fn: (cartId: string) => Promise<CartPromoView>) => {
    if (!live) return;
    const cartId = getLiveCartId();
    if (!cartId) {
      setPromoError('请先添加商品');
      return;
    }
    setPromoBusy(true);
    setPromoError(null);
    try {
      setPromo(await fn(cartId));
    } catch (err) {
      setPromoError(describeError(err));
    } finally {
      setPromoBusy(false);
    }
  }, [live]);

  const applyVoucher = useCallback(
    (code: string) => {
      const next = Array.from(new Set([...promo.voucherCodes, code]));
      void mutatePromo((cartId) => setCartVoucherCodes(cartId, next));
    },
    [promo.voucherCodes, mutatePromo],
  );
  const removeVoucher = useCallback(
    (code: string) => {
      const next = promo.voucherCodes.filter((c) => c !== code);
      void mutatePromo((cartId) => setCartVoucherCodes(cartId, next));
    },
    [promo.voucherCodes, mutatePromo],
  );
  const applyGiftCard = useCallback(
    (code: string) => {
      const next = Array.from(new Set([...promo.giftCardCodes, code]));
      void mutatePromo((cartId) => setCartGiftCardCodes(cartId, next));
    },
    [promo.giftCardCodes, mutatePromo],
  );
  const removeGiftCard = useCallback(
    (code: string) => {
      const next = promo.giftCardCodes.filter((c) => c !== code);
      void mutatePromo((cartId) => setCartGiftCardCodes(cartId, next));
    },
    [promo.giftCardCodes, mutatePromo],
  );

  // 回填草稿（返回/刷新不丢）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { form?: Partial<CheckoutForm>; step?: number };
        if (d.form) setForm((f) => ({ ...f, ...d.form }));
        if (d.step && d.step >= 1 && d.step <= 4) setStep(d.step);
      }
    } catch {
      /* sessionStorage 不可用时降级 */
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step }));
    } catch {
      /* noop */
    }
  }, [form, step, draftLoaded]);

  // live 模式：配送方式与支付方式都以后端为准（前端不许硬编码）。
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      setOptionsLoading(true);
      try {
        const cartId = getLiveCartId();
        const [ship, pay] = await Promise.all([
          loadLiveShippingOptions(form.country, cartId),
          loadLivePaymentProviders(cartId),
        ]);
        if (cancelled) return;
        setShippingOptions(ship);
        setPaymentProviders(pay);
        // 草稿里可能存着已下线的方案/渠道，回退到第一个可用项。
        setForm((f) => ({
          ...f,
          shippingOptionId: ship.some((o) => o.id === f.shippingOptionId)
            ? f.shippingOptionId
            : (ship[0]?.id ?? ''),
          paymentProviderId: pay.some((p) => p.id === f.paymentProviderId)
            ? f.paymentProviderId
            : (pay[0]?.id ?? ''),
        }));
      } catch (err) {
        if (!cancelled) setStepError(describeError(err));
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, form.country]);

  // 步骤切换 → 焦点落新步标题（h2 tabindex=-1）
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const setField = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onBlurField = (key: keyof CheckoutForm) => {
    const errs = validateStep(step, form);
    setErrors((e) => ({ ...e, [key]: errs[key] }));
  };

  const selectedShipping = shippingOptions.find((o) => o.id === form.shippingOptionId);
  const shippingMinor = selectedShipping?.amountMinor ?? 0;
  const taxMinor = 0;
  // live 模式：折扣以后端返回的 discount_minor 为准，前端绝不自己算折扣金额（铁律 13）。
  const discountMinor = live ? promo.discountMinor : 0;
  const totalMinor = subtotal.amountMinor + shippingMinor + taxMinor - discountMinor;
  const discountLines = live ? buildDiscountLines(promo) : [];
  const currency = subtotal.currencyCode;

  /**
   * 提交订单并发起支付（live 模式）。
   *
   * 调用顺序不能换：
   * 1. setShippingMethod —— 运费方案要落进购物车，下单时才会算进订单金额；
   * 2. completeCart —— 后端按购物车生成订单与支付集合；
   * 3. createPaymentSession —— 必须传 cart_id，后端据此复用第 2 步的支付集合
   *    （带正确金额与 order_id），否则支付成功后订单永远收不到 paid。
   *
   * 整段在「购物车锁」里跑：加购写操作必须与下单互斥，否则「刚加购就结算」
   * 会在购物车行还没写进去时就完成下单快照，顾客看到的金额和实际扣的不一样。
   */
  const submitLive = useCallback(async () => {
    // 购物车内容指纹：决定「复用这辆车重试」还是「换辆车出一笔新单」，
    // 也是下单幂等键的一部分（连点两次 → 同一个键 → 后端重放同一笔订单）。
    const lines = items.map((i) => ({ id: i.id, quantity: i.quantity }));
    const fingerprint = cartFingerprint(lines, form.shippingOptionId, form.email);

    const { order, session } = await withLiveCartLock(async () => {
      // 下单前把购物车整理成「可下单」状态（邮箱要对上 / 内容变了要换车）。
      const cartId = await prepareCartForOrder({
        email: form.email,
        items: lines.map((l) => ({ variantId: l.id, quantity: l.quantity })),
        fingerprint,
      });
      if (!cartId) throw new Error('购物车为空，请先选购商品');

      // 把优惠码/礼品卡码搬到最终下单的那辆车：换车（邮箱对不上/内容变化）时
      // prepareCartForOrder 只搬行、不搬码，若不重放，下单会按「无码」计价，
      // 展示价与实收价不一致。覆盖式设置幂等，复用原车时也不会有副作用。
      if (promo.voucherCodes.length > 0 || promo.giftCardCodes.length > 0) {
        await applyPromoCodesToCart(cartId, promo.voucherCodes, promo.giftCardCodes);
      }

      const result = await submitLiveCheckout({
        cartId,
        shippingOptionId: form.shippingOptionId,
        providerId: form.paymentProviderId,
        returnUrlFor: (orderId) =>
          `${window.location.origin}/${locale}/${channel}/checkout/result?order=${orderId}`,
        idempotencyKey: `checkout_${cartId}_${fingerprint}`,
      });
      // 记下「这辆车按此内容出过单」：重试同一内容复用这辆车，内容变了才换车。
      markCartOrdered(fingerprint);
      return result;
    });

    savePendingPayment({
      orderId: order.id,
      qrPayload: session.qrPayload,
      amountMinor: session.amountMinor,
      currencyCode: session.currencyCode,
      providerId: session.providerId,
      providerLabel:
        paymentProviders.find((p) => p.id === form.paymentProviderId)?.label ?? '支付',
      kind: session.kind,
    });

    const launch = resolvePaymentLaunch(session);
    if (launch.type === 'qrcode') {
      // 二维码形态（支付宝当面付）：跳到支付页展示二维码并轮询订单状态。
      router.push(`/${locale}/${channel}/checkout/pay?order=${order.id}`);
      return;
    }
    if (launch.type === 'redirect') {
      // 收银台形态（PayPal）：直接跳转支付商，付完由 return_url 回到结果页。
      window.location.href = launch.url;
      return;
    }
    throw new Error(launch.message);
  }, [
    form.email,
    form.shippingOptionId,
    form.paymentProviderId,
    items,
    paymentProviders,
    promo.voucherCodes,
    promo.giftCardCodes,
    router,
    locale,
    channel,
  ]);

  const goNext = () => {
    const errs = validateStep(step, form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setStepError('请完善当前步骤的必填信息');
      return;
    }
    setStepError(null);
    setErrors({});
    if (step < 4) {
      setStep(step + 1);
      return;
    }
    // 提交：创建订单（mock）→ 跳支付结果页（mock）；live → 真下单 + 发起支付
    setSubmitting(true);
    if (!live) {
      const order = createMockOrder();
      window.setTimeout(() => {
        router.push(`/${locale}/${channel}/checkout/result?order=${order.id}`);
      }, 400);
      return;
    }
    void (async () => {
      try {
        await submitLive();
      } catch (err) {
        setSubmitting(false);
        setStepError(describeError(err));
      }
    })();
  };

  const createMockOrder = () => {
    // mock 模式：本地造假订单（沙箱演示，不产生真实扣款）
    return createOrder({
      form,
      items: items.map((i) => ({
        title: i.title,
        variantTitle: i.variantTitle,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        imageUrl: i.imageUrl,
      })),
      subtotalMinor: subtotal.amountMinor,
      shippingMinor,
      taxMinor,
      totalMinor,
      currencyCode: currency,
      shippingOptionName: selectedShipping?.name ?? '标准跨境专线',
    });
  };

  const goBack = () => {
    setStepError(null);
    if (step > 1) setStep(step - 1);
  };

  const paymentLabel =
    paymentProviders.find((p) => p.id === form.paymentProviderId)?.label ?? '去支付';
  const ctaLabel = step === 4 ? `${paymentLabel} ${formatMoney(totalMinor, currency)}` : '下一步';
  const stepProps = { form, errors, setField, onBlurField };

  // 回填完成前先骨架，避免把「尚未加载」误判为空车
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-content px-4 py-6 pb-28 lg:pb-6">
        <h1 className="mb-4 text-xl md:text-2xl">结算</h1>
        <Skeleton className="mb-6 h-6 w-full max-w-md" />
        <div className="grid gap-8 lg:grid-cols-[8fr_4fr]">
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="hidden h-40 w-full lg:block" />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <p className="text-lg font-medium text-foreground">购物车是空的，无法结算</p>
        <p className="mt-1 text-sm text-muted-foreground">先挑选商品，再回来完成下单</p>
        <Button className="mt-4" onClick={() => router.push(`/${locale}/${channel}/products`)}>
          去逛逛
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-content px-4 py-6 pb-28 lg:pb-6">
      <h1 className="mb-4 text-xl md:text-2xl">结算</h1>
      <CheckoutStepper current={step} />

      <div className="mt-6 grid gap-8 lg:grid-cols-[8fr_4fr]">
        <div>
          {stepError && (
            <div className="mb-4 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive" role="alert">
              {stepError}
            </div>
          )}
          <h2 ref={headingRef} tabIndex={-1} className="mb-4 text-lg font-semibold outline-none">
            {step} / 4 · {CHECKOUT_STEPS[step - 1]}
          </h2>

          {step === 1 && <ContactStep {...stepProps} />}
          {step === 2 && <AddressStep {...stepProps} />}
          {step === 3 && (
            <ShippingStep
              {...stepProps}
              options={shippingOptions}
              loading={optionsLoading}
            />
          )}
          {step === 4 && (
            <PaymentStep
              {...stepProps}
              providers={paymentProviders}
              loading={optionsLoading}
              live={live}
            />
          )}

          {/* 底部操作条：移动吸底，桌面内联 */}
          <div className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] flex items-center gap-3 border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+var(--safe-area-bottom))] lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0">
            {step > 1 && (
              <IconButton aria-label="返回上一步" onClick={goBack} disabled={submitting}>
                <ArrowLeft className="size-6" strokeWidth={2} aria-hidden="true" />
              </IconButton>
            )}
            <Button size="lg" className="flex-1 lg:flex-none lg:px-10" onClick={goNext} loading={submitting} disabled={submitting}>
              {submitting ? '正在跳转…' : ctaLabel}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {live && (
            <PromoCodes
              voucherCodes={promo.voucherCodes}
              giftCardCodes={promo.giftCardCodes}
              busy={promoBusy}
              error={promoError}
              onApplyVoucher={applyVoucher}
              onApplyGiftCard={applyGiftCard}
              onRemoveVoucher={removeVoucher}
              onRemoveGiftCard={removeGiftCard}
            />
          )}
          <OrderSummary
            items={items}
            subtotal={subtotal}
            shippingMinor={shippingMinor}
            taxMinor={taxMinor}
            totalMinor={totalMinor}
            currencyCode={currency}
            shippingLabel={selectedShipping?.name}
            discountLines={discountLines}
          />
        </div>
      </div>
    </div>
  );
}
