import { ShieldCheck } from 'lucide-react';
import { cn } from '@mall/ui';
import { CHECKOUT_STEPS, PAYMENT_PROVIDERS, type StepProps } from '@/lib/checkout';

/** 步骤 4 支付方式：单选卡片（一期仅微信支付，沙箱）。 */
export function PaymentStep({ form, errors, setField }: StepProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{CHECKOUT_STEPS[3]}</legend>
      <div role="radiogroup" aria-label="支付方式" className="space-y-2">
        {PAYMENT_PROVIDERS.map((p) => {
          const checked = form.paymentProviderId === p.id;
          return (
            <label
              key={p.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors duration-150',
                checked ? 'border-primary bg-muted' : 'border-border hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name="paymentProvider"
                value={p.id}
                checked={checked}
                onChange={() => setField('paymentProviderId', p.id)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{p.label}</span>
                {checked && <span className="mt-1 block text-xs text-muted-foreground">{p.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        支付信息加密传输，本页为沙箱演示环境，不会产生真实扣款
      </p>
      {errors.paymentProviderId && (
        <p className="text-sm text-destructive" role="alert">
          {errors.paymentProviderId}
        </p>
      )}
    </fieldset>
  );
}
