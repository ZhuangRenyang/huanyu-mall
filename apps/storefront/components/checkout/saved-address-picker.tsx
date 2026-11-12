'use client';

import { MapPin, Plus } from 'lucide-react';
import { Badge, cn } from '@mall/ui';
import type { AddressRecord } from '@/lib/account';

interface SavedAddressPickerProps {
  addresses: AddressRecord[];
  selectedId: string | null;
  onPick: (address: AddressRecord) => void;
  onUseNew: () => void;
}

/**
 * 结账「选择收货地址」（ADR-026）。
 *
 * 登录顾客进结账先看到已保存的地址，默认地址预选 —— 淘宝和 Shopify 都是这个顺序：
 * 有地址就不该让顾客再填一遍。选中的地址会回填到下方表单，仍可临时修改。
 */
export function SavedAddressPicker({
  addresses,
  selectedId,
  onPick,
  onUseNew,
}: SavedAddressPickerProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-foreground">选择收货地址</legend>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="已保存的收货地址">
        {addresses.map((a) => {
          const active = selectedId === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(a)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors duration-150',
                active ? 'border-primary bg-primary-subtle' : 'border-border bg-card hover:bg-muted',
              )}
            >
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                <MapPin className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                {a.name}
                {a.phone && <span className="tabular text-xs text-muted-foreground">{a.phone}</span>}
                {a.isDefault && <Badge variant="brand">默认</Badge>}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {a.region} {a.line1}
              </p>
            </button>
          );
        })}

        <button
          type="button"
          role="radio"
          aria-checked={selectedId === null}
          onClick={onUseNew}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg border border-dashed p-3 text-sm transition-colors duration-150',
            selectedId === null
              ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          使用新地址
        </button>
      </div>
    </fieldset>
  );
}
