import { formatMoney, cn } from '@mall/ui';
import { CHECKOUT_STEPS, type ShippingOptionView, type StepProps } from '@/lib/checkout';

interface ShippingStepProps extends StepProps {
  /** 配送方式列表：live 模式取自后端，mock 模式用本地常量。 */
  options: ShippingOptionView[];
  /** 列表加载中（live 模式首屏）。 */
  loading?: boolean;
}

/** 步骤 3 配送方式：单选卡片（承运商 + 时效 + 运费）。选中态 border-primary + bg-muted。 */
export function ShippingStep({ form, errors, setField, options, loading }: ShippingStepProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{CHECKOUT_STEPS[2]}</legend>
      <div role="radiogroup" aria-label="配送方式" className="space-y-2">
        {options.map((opt) => {
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
                  {opt.eta && <span className="block text-xs text-muted-foreground">{opt.eta}</span>}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm">
                {opt.amountMinor === 0
                  ? '免运费'
                  : formatMoney(opt.amountMinor, opt.currencyCode)}
              </span>
            </label>
          );
        })}
        {loading && options.length === 0 && (
          <p className="text-sm text-muted-foreground" role="status">
            正在加载配送方式…
          </p>
        )}
        {!loading && options.length === 0 && (
          <p className="text-sm text-destructive" role="alert">
            当前渠道暂无可用配送方式，请联系客服。
          </p>
        )}
      </div>
      {errors.shippingOptionId && (
        <p className="text-sm text-destructive" role="alert">
          {errors.shippingOptionId}
        </p>
      )}
    </fieldset>
  );
}
