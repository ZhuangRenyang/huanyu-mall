'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button, IconButton, Skeleton, formatMoney } from '@mall/ui';
import { useCart } from '@/lib/cart-store';
import { readAffiliateRef } from '@/components/affiliate-capture';
import { getApiMode } from '@/lib/api';
import { getLiveCartId, markCartOrdered, prepareCartForOrder, withLiveCartLock } from '@/lib/live-cart';
import {
  applyPromoCodesToCart,
  buildDiscountLines,
  fetchCartPromo,
  fetchPointBalance,
  setCartGiftCardCodes,
  setCartPointsToUse,
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
  resolvePaymentLaunch,
  savePendingPayment,
  submitLiveCheckout,
  toShippingAddress,
  validateStep,
  type CheckoutErrors,
  type CheckoutForm,
  type PaymentProviderView,
} from '@/lib/checkout';
import { CheckoutStepper } from './checkout-stepper';
import { OrderSummary } from './order-summary';
import { countryLabel, guessCountry, loadCheckoutCountries } from '@/lib/countries';
import { setCartCountry } from '@/lib/promo';
import type { CheckoutCountry } from '@mall/sdk';
import { getAccessToken, listAddresses, type AddressRecord } from '@/lib/account';
import {
  fetchMyVouchers,
  voucherThresholdText,
  voucherValueText,
  type MyVoucherView,
} from '@/lib/vouchers';
import { ContactStep } from './contact-step';
import { AddressStep } from './address-step';
import { SavedAddressPicker } from './saved-address-picker';
import { PaymentStep } from './payment-step';
import { PromoCodes } from './promo-codes';
import { CustomerNote } from './customer-note';

const DRAFT_KEY = 'checkout:draft';
/** 手动改这些字段 = 不再是「选中的那条地址」，卡片要取消高亮。 */
const ADDRESS_FIELDS: Array<keyof CheckoutForm> = ['firstName', 'country', 'region', 'line1'];

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
  const [paymentProviders, setPaymentProviders] = useState<PaymentProviderView[]>(
    live ? [] : PAYMENT_PROVIDERS,
  );
  const [optionsLoading, setOptionsLoading] = useState(live);
  // 可选国家：以后端可配送范围为准（ADR-019），带各国家税率
  const [countries, setCountries] = useState<CheckoutCountry[]>([]);
  /** 配送范围是否已配置：'none' 时挡住下单（不让顾客填完地址才发现下不了单）。 */
  const [shippingStatus, setShippingStatus] = useState<'ok' | 'none' | 'unknown'>('unknown');
  /** 已登录顾客的地址簿：进到地址步才有值（游客留空，不打扰）。 */
  const [savedAddresses, setSavedAddresses] = useState<AddressRecord[]>([]);
  const [pickedAddressId, setPickedAddressId] = useState<string | null>(null);
  /** 我的卡券：登录顾客结账时直接选，不用记一串码（ADR-029）。 */
  const [myVouchers, setMyVouchers] = useState<MyVoucherView[]>([]);
  const [voucherCurrency, setVoucherCurrency] = useState('CNY');
  const headingRef = useRef<HTMLHeadingElement>(null);
  // mutatePromo 是 useCallback，直接依赖 form.country 会让每个按键都重建；
  // 用 ref 取最新国家，写码后重读合计时就能带上正确税率。
  const countryRef = useRef(form.country);
  countryRef.current = form.country;

  // live 模式：优惠码 / 礼品卡快照（金额一律后端算好，前端只透传展示）。
  const [promo, setPromo] = useState<CartPromoView>(EMPTY_PROMO);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  /** 当前顾客积分余额（ADR-094）：登录后拉一次，用于「用积分」输入框提示上限。 */
  const [pointBalance, setPointBalance] = useState(0);

  useEffect(() => {
    if (!live || !getAccessToken()) return;
    void fetchPointBalance().then(setPointBalance).catch(() => setPointBalance(0));
  }, [live]);

  // 可选国家清单：进页面拉一次；接口失败退回最小清单，后端说没配配送范围则挡住下单
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const result = await loadCheckoutCountries();
      if (cancelled) return;
      setCountries(result.items);
      setShippingStatus(result.status);
      // 草稿里的国家可能已下线：回退到清单第一个，避免「选了却不在列表里」
      setForm((f) =>
        result.items.some((c) => c.code === f.country)
          ? f
          : { ...f, country: result.items[0]?.code ?? f.country },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);

  // 进入结账页 / 换国家都走下面那个 effect（拉码 + 拉合计，刷新不丢，折扣以后端为准）。
  /*
   * 国家变了要重算：税率按收货国家解析（ADR-018），
   * 不重读的话合计还停在旧税率的数字，顾客看到的价与实付不一致。
   */
  useEffect(() => {
    if (!live) return;
    const cartId = getLiveCartId();
    if (!cartId) return;
    let cancelled = false;
    void (async () => {
      try {
        // 先把国家存到购物车：运费由系统按国家自动选，税率也按国家解析（ADR-019）
        if (form.country) await setCartCountry(cartId, form.country);
        const view = await fetchCartPromo(cartId);
        if (!cancelled) setPromo(view);
      } catch {
        /* 失败保持上次的数字，别把合计清成 0 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, form.country]);

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
      void mutatePromo((cartId) => setCartVoucherCodes(cartId, next, countryRef.current || undefined));
    },
    [promo.voucherCodes, mutatePromo],
  );
  const removeVoucher = useCallback(
    (code: string) => {
      const next = promo.voucherCodes.filter((c) => c !== code);
      void mutatePromo((cartId) => setCartVoucherCodes(cartId, next, countryRef.current || undefined));
    },
    [promo.voucherCodes, mutatePromo],
  );
  const applyGiftCard = useCallback(
    (code: string) => {
      const next = Array.from(new Set([...promo.giftCardCodes, code]));
      void mutatePromo((cartId) => setCartGiftCardCodes(cartId, next, countryRef.current || undefined));
    },
    [promo.giftCardCodes, mutatePromo],
  );
  const removeGiftCard = useCallback(
    (code: string) => {
      const next = promo.giftCardCodes.filter((c) => c !== code);
      void mutatePromo((cartId) => setCartGiftCardCodes(cartId, next, countryRef.current || undefined));
    },
    [promo.giftCardCodes, mutatePromo],
  );
  /** 设置积分抵扣意愿（ADR-094）：只传点数，抵扣额由后端折算封顶。 */
  const setPoints = useCallback(
    (points: number) => {
      void mutatePromo((cartId) => setCartPointsToUse(cartId, points, countryRef.current || undefined));
    },
    [mutatePromo],
  );

  // 回填草稿（返回/刷新不丢）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { form?: Partial<CheckoutForm>; step?: number };
        if (d.form) setForm((f) => ({ ...f, ...d.form }));
        if (d.step && d.step >= 1 && d.step <= 3) setStep(d.step);
      } else {
        // 首次进结账：按浏览器时区/语言猜一个国家，顾客只需要核对（全自动的起点）
        const guess = guessCountry();
        if (guess) setForm((f) => ({ ...f, country: guess }));
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

  /**
   * 已保存地址：只在「已登录 + 走到地址步」时拉一次。
   *
   * 游客不请求（避免无意义的 401），读失败也不挡结账 —— 表单照样能填，
   * 地址簿只是让老顾客少填一遍。
   */
  useEffect(() => {
    if (!live || step !== 2) return;
    if (!getAccessToken()) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await listAddresses();
        if (cancelled) return;
        setSavedAddresses(list);
        const preferred = list.find((a) => a.isDefault) ?? list[0];
        if (!preferred) return;
        // 默认地址预选 + 预填，但不覆盖草稿里顾客已经填过的内容
        setPickedAddressId((cur) => cur ?? preferred.id);
        setForm((f) =>
          f.firstName || f.region || f.line1
            ? f
            : {
                ...f,
                firstName: preferred.name,
                phone: preferred.phone || f.phone,
                country: preferred.countryCode || f.country,
                region: preferred.region,
                line1: preferred.line1,
              },
        );
      } catch {
        /* 地址簿不可用不影响下单 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, step]);

  /** 我的卡券：登录后拉一次，结账页直接列出可用券。 */
  useEffect(() => {
    if (!live) return;
    if (!getAccessToken()) return;
    let cancelled = false;
    void fetchMyVouchers()
      .then((res) => {
        if (cancelled) return;
        setMyVouchers(res.items);
        setVoucherCurrency(res.currencyCode);
      })
      .catch(() => {
        /* 拉不到券不影响下单，输码入口仍在 */
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  /** 选中一条已存地址：回填到表单，后续仍可临时改。 */
  const pickSavedAddress = (a: AddressRecord) => {
    setPickedAddressId(a.id);
    setForm((f) => ({
      ...f,
      firstName: a.name,
      phone: a.phone || f.phone,
      country: a.countryCode || f.country,
      region: a.region,
      line1: a.line1,
    }));
    setErrors({});
  };

  const useNewAddress = () => {
    setPickedAddressId(null);
    // 只清地址字段，联系方式（手机号/邮箱）不动
    setForm((f) => ({ ...f, firstName: '', region: '', line1: '' }));
    setErrors({});
  };

  // live 模式：支付方式以后端为准（前端不许硬编码）；运费与税由后端按国家自动算。
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      setOptionsLoading(true);
      try {
        const cartId = getLiveCartId();
        const pay = await loadLivePaymentProviders(cartId);
        if (cancelled) return;
        setPaymentProviders(pay);
        // 草稿里可能存着已下线的渠道，回退到第一个可用项
        setForm((f) => ({
          ...f,
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
  }, [live]);

  // 步骤切换 → 焦点落新步标题（h2 tabindex=-1）
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const setField = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    // 手动改了地址字段，就不再是「选中的那条」，取消卡片高亮以免误导
    if (ADDRESS_FIELDS.includes(key)) setPickedAddressId(null);
  };

  const onBlurField = (key: keyof CheckoutForm) => {
    const errs = validateStep(step, form);
    setErrors((e) => ({ ...e, [key]: errs[key] }));
  };

  // 运费由后端按国家自动选定（ADR-019）；mock 模式用第一个方案演示
  const shippingMinor = live ? promo.shippingMinor : (SHIPPING_OPTIONS[0]?.amountMinor ?? 0);
  const shippingLabel = live ? promo.shippingLabel : (SHIPPING_OPTIONS[0]?.name ?? '');
  // live 模式：税与合计都取后端（含税/价外由后端口径决定，前端不再自己加税）。
  const taxMinor = live ? promo.taxMinor : 0;
  const discountMinor = live ? promo.discountMinor : 0;
  const totalMinor = live
    ? // 后端 total 已含运费与税；还没拉到合计时才退回本地估算
      (promo.totalsLoaded
        ? promo.totalMinor
        : subtotal.amountMinor + shippingMinor - discountMinor)
    : subtotal.amountMinor + shippingMinor - discountMinor;
  const discountLines = live ? buildDiscountLines(promo) : [];
  const currency = subtotal.currencyCode;
  /** 只列「未用且未过期」的券；已用的没必要占结账页的地方。 */
  const usableVouchers = myVouchers.filter((v) => v.status === 'unused' && !v.expired);

  /**
   * 提交订单并发起支付（live 模式）。
   *
   * 调用顺序不能换：
   * 1. completeCart —— 后端按购物车生成订单与支付集合（运费与税已在服务端算好）；
   * 2. createPaymentSession —— 必须传 cart_id，后端据此复用第 2 步的支付集合
   *    （带正确金额与 order_id），否则支付成功后订单永远收不到 paid。
   *
   * 整段在「购物车锁」里跑：加购写操作必须与下单互斥，否则「刚加购就结算」
   * 会在购物车行还没写进去时就完成下单快照，顾客看到的金额和实际扣的不一样。
   */
  const submitLive = useCallback(async () => {
    // 购物车内容指纹：决定「复用这辆车重试」还是「换辆车出一笔新单」，
    // 也是下单幂等键的一部分（连点两次 → 同一个键 → 后端重放同一笔订单）。
    const lines = items.map((i) => ({ id: i.id, quantity: i.quantity }));
    // 运费不再由顾客选，指纹里用购物车国家（换国家 = 换价格 = 应出新单）
    const fingerprint = cartFingerprint(lines, form.country, form.email);

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
      // 积分抵扣意愿也要搬到最终下单的那辆车（ADR-094）：换车只搬行不搬积分
      if (promo.pointsToUse > 0) {
        await setCartPointsToUse(cartId, promo.pointsToUse);
      }

      const result = await submitLiveCheckout({
        cartId,
        providerId: form.paymentProviderId,
        returnUrlFor: (orderId) =>
          `${window.location.origin}/${locale}/${channel}/checkout/result?order=${orderId}`,
        idempotencyKey: `checkout_${cartId}_${fingerprint}`,
        shippingAddress: toShippingAddress(form),
        // 给卖家留言：与地址同一条请求带下去，别单独再发一次（少一次可失败的调用）
        customerNote: form.note,
        // 分销归因（ADR-101）：只传落地时记下的推广码，金额一律服务端算
        affiliateCode: readAffiliateRef(),
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
    form.note,
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
    if (step < 3) {
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
      shippingOptionName: shippingLabel || '标准跨境专线',
    });
  };

  const goBack = () => {
    setStepError(null);
    if (step > 1) setStep(step - 1);
  };

  const paymentLabel =
    paymentProviders.find((p) => p.id === form.paymentProviderId)?.label ?? '去支付';
  const ctaLabel = step === 3 ? `${paymentLabel} ${formatMoney(totalMinor, currency)}` : '下一步';
  const countryOptions =
    countries.length > 0
      ? countries.map((c) => ({ code: c.code, name: countryLabel(c) }))
      : undefined;
  const stepProps = { form, errors, setField, onBlurField, countries: countryOptions };

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

  /*
   * 商家还没配配送范围（一个发货区都没有）。
   *
   * 这时不能渲染结账表单：顾客会填完地址、点支付，才在服务端拿到「无可用运费方案」。
   * 把失败点前移到这一屏，说清「暂不配送」，比让顾客白填一遍强。
   */
  if (live && shippingStatus === 'none') {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <p className="text-lg font-medium text-foreground">暂无可配送地区</p>
        <p className="mt-1 text-sm text-muted-foreground">
          商家尚未开通配送范围，暂时无法下单，请联系店铺客服
        </p>
        <Button className="mt-4" onClick={() => router.push(`/${locale}/${channel}/products`)}>
          返回商品
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
            {step} / 3 · {CHECKOUT_STEPS[step - 1]}
          </h2>

          {step === 1 && <ContactStep {...stepProps} />}
          {step === 2 && (
            <div className="space-y-4">
              {/* 有保存过的地址就先让顾客选，省掉重填一遍（游客没有这一块） */}
              {live && savedAddresses.length > 0 && (
                <SavedAddressPicker
                  addresses={savedAddresses}
                  selectedId={pickedAddressId}
                  onPick={pickSavedAddress}
                  onUseNew={useNewAddress}
                />
              )}
              <AddressStep {...stepProps} />
            </div>
          )}
          {step === 3 && (
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
            <>
              {usableVouchers.length > 0 && (
                <section
                  aria-labelledby="my-vouchers-heading"
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <h3 id="my-vouchers-heading" className="mb-2 text-sm font-semibold text-foreground">
                    我的优惠券
                  </h3>
                  <ul className="space-y-2">
                    {usableVouchers.map((v) => {
                      const applied = promo.voucherCodes.includes(v.code);
                      // 门槛不满足时不禁用「选」，但先告诉顾客差多少 —— 选了也会被后端拒
                      const eligible = !v.minSpentMinor || subtotal.amountMinor >= v.minSpentMinor;
                      return (
                        <li key={v.id}>
                          <button
                            type="button"
                            disabled={promoBusy}
                            onClick={() => (applied ? removeVoucher(v.code) : applyVoucher(v.code))}
                            className={
                              applied
                                ? 'flex w-full items-center justify-between gap-3 rounded-md border border-primary bg-primary-subtle px-3 py-2 text-left'
                                : 'flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-muted'
                            }
                          >
                            <span className="min-w-0">
                              <span className="text-sm font-semibold text-accent-orange-deep">
                                {voucherValueText(v, voucherCurrency)}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {voucherThresholdText(v.minSpentMinor, voucherCurrency)}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {v.name}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs">
                              {applied ? '已使用' : eligible ? '使用' : '未满门槛'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <PromoCodes
                voucherCodes={promo.voucherCodes}
                giftCardCodes={promo.giftCardCodes}
                pointBalance={pointBalance}
                pointsToUse={promo.pointsToUse}
                busy={promoBusy}
                error={promoError}
                onApplyVoucher={applyVoucher}
                onApplyGiftCard={applyGiftCard}
                onRemoveVoucher={removeVoucher}
                onRemoveGiftCard={removeGiftCard}
                onSetPoints={setPoints}
              />
            </>
          )}
          {/* 淘宝的「给卖家留言」就在商品与优惠之后、合计之前 */}
          <CustomerNote value={form.note} onChange={(note) => setField('note', note)} />
          <OrderSummary
            items={items}
            subtotal={subtotal}
            shippingMinor={shippingMinor}
            taxMinor={taxMinor}
            totalMinor={totalMinor}
            currencyCode={currency}
            shippingLabel={shippingLabel}
            discountLines={discountLines}
          />
        </div>
      </div>
    </div>
  );
}
