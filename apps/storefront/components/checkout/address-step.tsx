import { CHECKOUT_STEPS, COUNTRIES, type StepProps } from '@/lib/checkout';
import { SelectField, TextAreaField, TextField } from '@/components/form-field';

/** 步骤 2 收货地址：收件人 / 国家 / 省市区 / 详细地址（4 字段，≤4 约束）。 */
export function AddressStep({ form, errors, setField, onBlurField }: StepProps) {
  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">{CHECKOUT_STEPS[1]}</legend>
      <TextField
        id="firstName"
        label="收件人"
        required
        autoComplete="name"
        placeholder="收货人姓名"
        value={form.firstName}
        onChange={(e) => setField('firstName', e.target.value)}
        onBlur={() => onBlurField('firstName')}
        error={errors.firstName}
      />
      <SelectField
        id="country"
        label="国家 / 地区"
        required
        options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
        value={form.country}
        onChange={(e) => setField('country', e.target.value)}
        onBlur={() => onBlurField('country')}
        error={errors.country}
      />
      <TextField
        id="region"
        label="省 / 市 / 区"
        required
        autoComplete="address-level2"
        placeholder="如：广东省深圳市南山区"
        value={form.region}
        onChange={(e) => setField('region', e.target.value)}
        onBlur={() => onBlurField('region')}
        error={errors.region}
      />
      <TextAreaField
        id="line1"
        label="详细地址"
        required
        autoComplete="street-address"
        placeholder="街道、门牌号、楼层等"
        value={form.line1}
        onChange={(e) => setField('line1', e.target.value)}
        onBlur={() => onBlurField('line1')}
        error={errors.line1}
      />
    </fieldset>
  );
}
