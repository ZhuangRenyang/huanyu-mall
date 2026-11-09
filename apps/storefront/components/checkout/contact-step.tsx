import { CHECKOUT_STEPS, type StepProps } from '@/lib/checkout';
import { TextField } from '@/components/form-field';

/** 步骤 1 联系方式：手机号（软标识）+ 邮箱（选填）。游客可直接下单。 */
export function ContactStep({ form, errors, setField, onBlurField }: StepProps) {
  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">{CHECKOUT_STEPS[0]}</legend>
      <TextField
        id="phone"
        label="手机号"
        required
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        placeholder="11 位手机号"
        value={form.phone}
        onChange={(e) => setField('phone', e.target.value)}
        onBlur={() => onBlurField('phone')}
        error={errors.phone}
        hint="仅用于订单联系，一期不做短信验证，可直接以游客身份下单"
      />
      <TextField
        id="email"
        label="邮箱"
        type="email"
        autoComplete="email"
        placeholder="选填，用于接收订单通知"
        value={form.email}
        onChange={(e) => setField('email', e.target.value)}
        onBlur={() => onBlurField('email')}
        error={errors.email}
      />
    </fieldset>
  );
}
