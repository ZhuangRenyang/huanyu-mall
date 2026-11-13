import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, cn } from '@mall/ui';

type AriaProps = { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string };

/**
 * 表单字段容器：Label + 控件 + 错误文案。
 *
 * 无障碍链路：`Label htmlFor` 关联控件 id → 控件带 `aria-invalid` 与 `aria-describedby`
 * 指向错误节点 → 错误节点 `role="alert"`。这样错误态同时被视觉（红边）与屏幕阅读器感知，
 * 而不是只靠颜色。
 *
 * 迁移说明：控件本体已换成 `@mall/ui` 的 `Input` / `Textarea` / `Select`（shadcn 形态），
 * 本文件只做布局与无障碍串联，不再自己写输入框样式。
 */
function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  /** 说明文案（错误时让位给错误，两者不叠加）。 */
  hint?: string;
  children: (aria: AriaProps) => React.ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <Label htmlFor={id} className="mb-1">
        {label}
        {required && (
          <span className="ml-0.5 text-accent-orange-deep" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
};

export function TextField({ id, label, error, required, className, ...props }: TextFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error}>
      {(aria) => <Input {...aria} aria-required={required} className={className} {...props} />}
    </Field>
  );
}

export type SelectFieldProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  error?: string;
  required?: boolean;
  /**
   * 保持与原生 select 一致的事件签名：调用方仍写 `onChange={(e) => setX(e.target.value)}`。
   * Radix Select 的原生回调是 `onValueChange(string)`，这里在内部合成一个同形事件，
   * 使这次迁移对调用方零改动（否则每个使用点都要改回调，回归面会扩大）。
   */
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
};

export function SelectField({
  id,
  label,
  options,
  error,
  required,
  className,
  value,
  onChange,
  ...props
}: SelectFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error}>
      {(aria) => (
        <Select
          value={value === undefined || value === null ? undefined : String(value)}
          onValueChange={(next) => {
            onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
          }}
          disabled={props.disabled}
          name={props.name}
          required={required}
        >
          <SelectTrigger id={aria.id} aria-invalid={Boolean(error)} aria-required={required} className={className}>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

export type TextAreaFieldProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
};

export function TextAreaField({ id, label, error, required, hint, className, ...props }: TextAreaFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      {(aria) => (
        <Textarea
          {...aria}
          aria-required={required}
          /* rows=2 与迁移前的原生 textarea 一致（视觉零变化门禁要求） */
          rows={2}
          className={cn('min-h-[64px] py-2', className)}
          {...props}
        />
      )}
    </Field>
  );
}
