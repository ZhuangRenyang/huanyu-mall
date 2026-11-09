import { Check } from 'lucide-react';
import { cn } from '@mall/ui';
import { formatDateTime, type TimelineItem } from '@/lib/orders';

/** 订单状态时间线（横向 4 步）：完成=Check、当前=实心 primary、未达=灰。 */
export function OrderTimeline({ items }: { items: TimelineItem[] }) {
  const lastDone = items.reduce((acc, it, i) => (it.at !== undefined ? i : acc), -1);

  return (
    <ol className="grid grid-cols-4" role="list" aria-label="订单状态时间线">
      {items.map((it, i) => {
        const done = it.at !== undefined;
        const current = i === lastDone;
        const nextDone = items[i + 1]?.at !== undefined;
        return (
          <li key={it.key} className="relative flex flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
            {i < items.length - 1 && (
              <span
                className={cn('absolute left-1/2 top-3.5 h-px w-full', nextDone ? 'bg-primary' : 'bg-border')}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                'relative z-10 grid size-7 place-items-center rounded-full text-xs font-medium',
                current
                  ? 'bg-primary text-primary-foreground'
                  : done
                    ? 'bg-success-subtle text-success'
                    : 'bg-muted text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {done && !current ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
            </span>
            <span
              className={cn(
                'mt-2 whitespace-nowrap text-xs',
                current ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {it.label}
            </span>
            <span className="mt-0.5 text-[10px] text-muted-foreground">{it.at ? formatDateTime(it.at).slice(5, 10) : '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}
