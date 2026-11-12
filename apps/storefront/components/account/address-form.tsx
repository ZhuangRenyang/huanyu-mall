'use client';

import { useEffect, useState } from 'react';
import { Button } from '@mall/ui';
import { SelectField, TextAreaField, TextField } from '@/components/form-field';
import { loadCheckoutCountries } from '@/lib/countries';
import type { AddressInput, AddressRecord } from '@/lib/account';

export interface AddressFormProps {
  initial?: AddressRecord;
  onSave: (input: AddressInput, id?: string) => Promise<void>;
  onCancel: () => void;
}

const PHONE_RE = /^1[3-9]\d{9}$/;

/**
 * 新增 / 编辑收货地址（对齐淘宝「收货地址」表单）。
 *
 * 字段顺序就是顾客填写的顺序：收件人 → 手机号 → 所在地区 → 详细地址。
 * 不做 Shopify 那套 first/last、邮编拆分 —— 中文地址不这么填，
 * 逼顾客拆姓/名只会得到一堆乱填的数据（ADR-026）。
 */
export function AddressForm({ initial, onSave, onCancel }: AddressFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [country, setCountry] = useState(initial?.countryCode ?? 'CN');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [countries, setCountries] = useState<Array<{ code: string; name: string }>>([]);

  // 国家清单与结账页同源（后端可配送范围）；拿不到就退回内置清单，至少能填中国
  useEffect(() => {
    let cancelled = false;
    void loadCheckoutCountries().then((result) => {
      if (cancelled) return;
      setCountries(result.items.map((c) => ({ code: c.code, name: c.name })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (name.trim().length < 1 || name.trim().length > 30) e.name = '收件人需 1–30 个字符';
    if (!phone.trim()) {
      e.phone = '请填写手机号';
    } else if (country === 'CN' && !PHONE_RE.test(phone.trim().replace(/[\s-]/g, ''))) {
      e.phone = '请输入 11 位有效手机号';
    }
    if (!region.trim()) e.region = '请填写省 / 市 / 区';
    if (line1.trim().length < 2) e.line1 = '详细地址至少 2 个字符';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    setFormError(null);
    try {
      await onSave(
        {
          name: name.trim(),
          phone: phone.trim(),
          region: region.trim(),
          line1: line1.trim(),
          countryCode: country,
          isDefault,
        },
        initial?.id,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const countryOptions =
    countries.length > 0 ? countries : [{ code: 'CN', name: '中国' }];

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="addr-name"
          label="收件人"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextField
          id="addr-phone"
          label="手机号"
          required
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
        />
      </div>
      <SelectField
        id="addr-country"
        label="国家 / 地区"
        required
        options={countryOptions.map((c) => ({ value: c.code, label: c.name }))}
        value={country}
        onChange={(e) => setCountry(e.target.value)}
      />
      <TextField
        id="addr-region"
        label="省 / 市 / 区"
        required
        autoComplete="address-level2"
        placeholder="如：广东省深圳市南山区"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        error={errors.region}
      />
      <TextAreaField
        id="addr-line1"
        label="详细地址"
        required
        autoComplete="street-address"
        placeholder="街道、门牌号、楼层等"
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        error={errors.line1}
      />
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="size-4 accent-primary"
        />
        设为默认地址
      </label>
      {formError && (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="md" loading={saving}>
          保存
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={saving}>
          取消
        </Button>
      </div>
    </form>
  );
}
