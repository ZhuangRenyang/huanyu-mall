import { formatMoney, cn } from '@mall/ui';
import { CHECKOUT_STEPS, SHIPPING_OPTIONS, type StepProps } from '@/lib/checkout';

/** 步骤 3 配送方式：单选卡片（承运商 + 时效 + 运费）。选中态 border-primary + bg-muted。 */
export function ShippingStep({ form, errors, setField }: StepProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{CHECKOUT_STEPS[2]}</legend>
      <div role="radiogroup" aria-label="配送方式" className="space-y-2">
        {SHIPPING_OPTIONS.map((opt) => {
          const checked = form.shippingOptionId === opt.id;
          return (
            <label
              key={opt.id}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors duration-150',
                checked ? 'border-primary bg-muted' : 'border-border hover:border-border-strong',
              )}
            >
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="shippingOption"
                  value={opt.id}
                  checked={checked}
                  onChange={() => setField('shippingOptionId', opt.id)}
                  className="mt-1 size-4 accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{opt.name}</span>
                  <span className="block text-xs text-muted-foreground">{opt.eta}</span>
                </span>
              </span>
              <span className="tabular shrink-0 text-sm">
                {opt.amountMinor === 0 ? '免运费' : formatMoney(opt.amountMinor, 'CNY')}
              </span>
            </label>
          );
        })}
      </div>
      {errors.shippingOptionId && (
        <p className="text-sm text-destructive" role="alert">
          {errors.shippingOptionId}
        </p>
      )}
    </fieldset>
  );
}
