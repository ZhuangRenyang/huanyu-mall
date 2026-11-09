import type { LucideIcon } from 'lucide-react';
import { cn } from './lib/cn';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** 主操作（如「去逛逛」）。 */
  action?: React.ReactNode;
  /** 次操作。 */
  secondaryAction?: React.ReactNode;
  className?: string;
}

/**
 * 空态：图标（neutral-300）→ 主文案 → 辅助 → 操作。每一处都是二次转化位。
 * 禁止做大插画 + 居中的模板。
 */
export function EmptyState({ icon: Icon, title, description, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-start gap-3 py-12', className)}>
      <Icon className="size-6 text-neutral-300" strokeWidth={2} aria-hidden="true" />
      <p className="text-lg font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
