import { cn } from './lib/cn';
import { formatMoney, type MinorAmount } from './lib/format';

export interface PriceProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 现价（最小单位）。 */
  amountMinor: MinorAmount;
  currencyCode?: string;
  /** 划线原价（促销场景）。 */
  originalMinor?: MinorAmount;
  /** 现价使用促销橙（仅当同时给了 originalMinor 时通常为 true）。 */
  promo?: boolean;
  /** 字号档：默认 sm，可覆盖 text-xl 等。 */
  size?: 'sm' | 'base' | 'xl';
}

const sizeClasses = {
  sm: 'text-sm',
  base: 'text-base',
  xl: 'text-xl',
} as const;

/**
 * 价格块：现价 + 可选划线原价 + 省额。
 * 金额用等宽数字（tabular-nums），右对齐成列时无跳动。
 */
export function Price({
  className,
  amountMinor,
  currencyCode = 'CNY',
  originalMinor,
  promo = false,
  size = 'base',
  ...props
}: PriceProps) {
  const hasOriginal = originalMinor !== undefined;
  const displayClass = promo && hasOriginal ? 'text-accent-orange-deep' : 'text-foreground';

  return (
    <span className={cn('inline-flex items-baseline gap-2', className)} {...props}>
      <span className={cn('tabular', displayClass, sizeClasses[size])}>
        {formatMoney(amountMinor, currencyCode)}
      </span>
      {hasOriginal && (
        <span className="tabular text-sm text-muted-foreground line-through">
          {formatMoney(originalMinor, currencyCode)}
        </span>
      )}
    </span>
  );
}
