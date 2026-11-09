'use client';

import { useState } from 'react';
import { Button } from '@mall/ui';
import { TextField } from '@/components/form-field';
import type { AddressInput, AddressRecord } from '@/lib/account';

export interface AddressFormProps {
  initial?: AddressRecord;
  onSave: (input: AddressInput, id?: string) => void;
  onCancel: () => void;
}

/** 新增 / 编辑地址表单（4 字段 + 默认地址勾选）。 */
export function AddressForm({ initial, onSave, onCancel }: AddressFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (name.trim().length < 1 || name.trim().length > 30) e.name = '收件人姓名需 1–30 个字符';
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) e.phone = '请输入 11 位有效手机号';
    if (!region.trim()) e.region = '请填写省 / 市 / 区';
    if (line1.trim().length < 5) e.line1 = '详细地址至少 5 个字符';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSave({ name: name.trim(), phone: phone.trim(), region: region.trim(), line1: line1.trim(), isDefault }, initial?.id);
  };

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
      <TextField
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
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="size-4 accent-primary" />
        设为默认地址
      </label>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="md">
          保存
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
