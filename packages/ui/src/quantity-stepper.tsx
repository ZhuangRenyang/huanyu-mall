'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from './lib/cn';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  decreaseLabel?: string;
  increaseLabel?: string;
  className?: string;
}

/** 数量步进器：− / +，按钮 44×44 触摸区（视觉可更小，命中区外扩）。 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  decreaseLabel = '减少数量',
  increaseLabel = '增加数量',
  className,
}: QuantityStepperProps) {
  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  const dec = () => {
    if (disabled || atMin) return;
    onChange(Math.max(min, value - 1));
  };
  const inc = () => {
    if (disabled || atMax) return;
    onChange(Math.min(max ?? Number.MAX_SAFE_INTEGER, value + 1));
  };

  const btnClass =
    'grid size-11 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <button type="button" aria-label={decreaseLabel} className={btnClass} onClick={dec} disabled={disabled || atMin}>
        <Minus className="size-5" strokeWidth={2} aria-hidden="true" />
      </button>
      <span className="tabular min-w-8 text-center text-base font-medium">{value}</span>
      <button type="button" aria-label={increaseLabel} className={btnClass} onClick={inc} disabled={disabled || atMax}>
        <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
