import { cn } from '@mall/ui';

/**
 * 共享表单字段（结账 / 账户 / 地址簿复用）。
 * 内置 label 关联、aria-invalid、aria-describedby、错误 role=alert。
 */

type AriaProps = { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string };

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
  hint?: string;
  children: (aria: AriaProps) => React.ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-accent-orange-deep" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function controlClass(error?: string, className?: string) {
  return cn(
    'w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground',
    error ? 'border-destructive' : 'border-input focus:border-ring',
    className,
  );
}

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
}

export function TextField({ id, label, required, error, hint, className, ...inputProps }: TextFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      {(aria) => (
        <input {...aria} aria-required={required} className={controlClass(error, cn('h-11', className))} {...inputProps} />
      )}
    </Field>
  );
}

export interface TextAreaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
}

export function TextAreaField({ id, label, required, error, hint, className, ...props }: TextAreaFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      {(aria) => (
        <textarea {...aria} aria-required={required} rows={2} className={controlClass(error, cn('min-h-[72px] py-2', className))} {...props} />
      )}
    </Field>
  );
}

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectField({ id, label, required, error, hint, options, placeholder, className, ...props }: SelectFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      {(aria) => (
        <select {...aria} aria-required={required} className={controlClass(error, cn('h-11', className))} {...props}>
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
