'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button, IconButton, Skeleton, formatMoney } from '@mall/ui';
import { useCart } from '@/lib/cart-store';
import {
  CHECKOUT_STEPS,
  PAYMENT_PROVIDERS,
  SHIPPING_OPTIONS,
  createOrder,
  emptyForm,
  validateStep,
  type CheckoutErrors,
  type CheckoutForm,
} from '@/lib/checkout';
import { CheckoutStepper } from './checkout-stepper';
import { OrderSummary } from './order-summary';
import { ContactStep } from './contact-step';
import { AddressStep } from './address-step';
import { ShippingStep } from './shipping-step';
import { PaymentStep } from './payment-step';

const DRAFT_KEY = 'checkout:draft';

export function CheckoutFlow({ locale, channel }: { locale: string; channel: string }) {
  const router = useRouter();
  const { items, subtotal, hydrated } = useCart();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CheckoutForm>(emptyForm);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  const selectedShipping = SHIPPING_OPTIONS.find((o) => o.id === form.shippingOptionId);
  const shippingMinor = selectedShipping?.amountMinor ?? 0;
  const taxMinor = 0;
  const totalMinor = subtotal.amountMinor + shippingMinor + taxMinor;
  const currency = subtotal.currencyCode;

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
    // 提交：创建订单（mock）→ 跳支付结果页
    setSubmitting(true);
    const order = createOrder({
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
    window.setTimeout(() => {
      router.push(`/${locale}/${channel}/checkout/result?order=${order.id}`);
    }, 400);
  };

  const goBack = () => {
    setStepError(null);
    if (step > 1) setStep(step - 1);
  };

  const paymentLabel = PAYMENT_PROVIDERS.find((p) => p.id === form.paymentProviderId)?.label ?? '去支付';
  const ctaLabel = step === 4 ? `${paymentLabel} ${formatMoney(totalMinor, currency)}` : '下一步';
  const stepProps = { form, errors, setField, onBlurField };

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
          {step === 3 && <ShippingStep {...stepProps} />}
          {step === 4 && <PaymentStep {...stepProps} />}

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

        <OrderSummary
          items={items}
          subtotal={subtotal}
          shippingMinor={shippingMinor}
          taxMinor={taxMinor}
          totalMinor={totalMinor}
          currencyCode={currency}
          shippingLabel={selectedShipping?.name}
        />
      </div>
    </div>
  );
}
