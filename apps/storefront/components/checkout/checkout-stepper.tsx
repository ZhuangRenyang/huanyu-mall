import { Check } from 'lucide-react';
import { cn } from '@mall/ui';
import { CHECKOUT_STEPS } from '@/lib/checkout';

/** 4 步进度：完成=Check、当前=实心、未达=灰。移动只显圆点，桌面显文字。 */
export function CheckoutStepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="结账进度">
      {CHECKOUT_STEPS.map((label, i) => {
        const stepNo = i + 1;
        const done = stepNo < current;
        const active = stepNo === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            {i > 0 && <span className={cn('h-px w-4 sm:w-8', done || active ? 'bg-primary' : 'bg-border')} aria-hidden="true" />}
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium',
                done || active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {done ? <Check className="size-4" strokeWidth={2.5} /> : stepNo}
            </span>
            <span className={cn('hidden text-xs sm:inline', active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
