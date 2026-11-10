import { ShieldCheck } from 'lucide-react';
import { cn } from '@mall/ui';
import { CHECKOUT_STEPS, type PaymentProviderView, type StepProps } from '@/lib/checkout';

interface PaymentStepProps extends StepProps {
  /** 支付方式列表：live 模式取自后端（只列已启用的渠道），mock 模式用本地常量。 */
  providers: PaymentProviderView[];
  /** 列表加载中（live 模式首屏）。 */
  loading?: boolean;
  /** live 模式：真实收款，文案不能再说「不会真实扣款」。 */
  live?: boolean;
}

/** 步骤 4 支付方式：单选卡片（live 模式由后端返回已启用的支付渠道）。 */
export function PaymentStep({ form, errors, setField, providers, loading, live }: PaymentStepProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{CHECKOUT_STEPS[3]}</legend>
      <div role="radiogroup" aria-label="支付方式" className="space-y-2">
        {providers.map((p) => {
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
        {loading && providers.length === 0 && (
          <p className="text-sm text-muted-foreground" role="status">
            正在加载支付方式…
          </p>
        )}
        {!loading && providers.length === 0 && (
          <p className="text-sm text-destructive" role="alert">
            当前渠道暂无可用支付方式，请联系客服。
          </p>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        {live
          ? '支付信息加密传输，将由第三方支付渠道完成扣款，请确认后支付'
          : '支付信息加密传输，本页为沙箱演示环境，不会产生真实扣款'}
      </p>
      {errors.paymentProviderId && (
        <p className="text-sm text-destructive" role="alert">
          {errors.paymentProviderId}
        </p>
      )}
    </fieldset>
  );
}
