'use client';

import { useState } from 'react';
import { cn } from './lib/cn';
import type { VariantOptionGroup } from './types';

export interface VariantPickerProps {
  options: VariantOptionGroup[];
  /** 已选值：groupId → value。 */
  value: Record<string, string>;
  onChange: (groupId: string, value: string) => void;
  /** 可选库存：`groupId:value` → 可用量（0 视为售罄）。 */
  stockMap?: Record<string, number>;
  /** 额外禁用项（`groupId:value`），渲染删除线 + aria-disabled。 */
  disabledKeys?: string[];
}

function optionKey(groupId: string, val: string): string {
  return `${groupId}:${val}`;
}

/**
 * 规格选择器（颜色 swatch / 尺码按钮）。radio group 语义。
 * 售罄项：删除线 + muted + aria-disabled，点击提示「该规格已售罄」。
 */
export function VariantPicker({ options, value, onChange, stockMap, disabledKeys = [] }: VariantPickerProps) {
  const [soldoutGroup, setSoldoutGroup] = useState<string | null>(null);

  if (options.length === 0) return null;

  return (
    <div className="space-y-4">
      {options.map((group) => {
        const selected = value[group.id];
        const soldout = soldoutGroup === group.id;
        return (
          <fieldset key={group.id} className="space-y-2">
            <legend className="text-sm font-medium text-foreground">
              {group.name}
              {selected && <span className="ml-2 text-sm font-normal text-muted-foreground">{selected}</span>}
            </legend>
            <div role="radiogroup" aria-label={group.name} className="flex flex-wrap gap-2">
              {group.values.map((opt) => {
                const key = optionKey(group.id, opt.value);
                const qty = stockMap?.[key];
                const isDisabled = disabledKeys.includes(key) || qty === 0;
                const isSelected = selected === opt.value;

                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-disabled={isDisabled || undefined}
                    onClick={() => {
                      if (isDisabled) {
                        setSoldoutGroup(group.id);
                        return;
                      }
                      setSoldoutGroup(null);
                      onChange(group.id, opt.value);
                    }}
                    className={cn(
                      'inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-3 text-sm',
                      'transition-colors duration-150',
                      isSelected
                        ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
                        : 'border-border-strong text-foreground hover:border-input',
                      isDisabled && 'text-muted-foreground line-through',
                    )}
                  >
                    {opt.swatch && (
                      <span
                        className="size-4 shrink-0 rounded-full border border-border-strong"
                        style={{ backgroundColor: opt.swatch }}
                        aria-hidden="true"
                      />
                    )}
                    {opt.label ?? opt.value}
                  </button>
                );
              })}
            </div>
            {soldout && (
              <p className="text-sm text-destructive" role="alert">
                该规格已售罄，试试其他规格
              </p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
