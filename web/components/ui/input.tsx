import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className, id, ...rest }: InputProps) {
  const inputId = id ?? (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined)
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-xs font-medium text-ink-tertiary">{label}</label>}
      <input
        id={inputId}
        className={cn(
          'w-full rounded-lg border bg-surface px-3 py-2 text-base text-ink-primary outline-none transition-colors',
          'placeholder:text-ink-muted focus:ring-2',
          error
            ? 'border-danger-solid focus:ring-danger-solid/30'
            : 'border-hairline focus:border-blue-500 focus:ring-blue-500/20',
          'disabled:opacity-50', className,
        )}
        {...rest}
      />
      {error && <span className="text-xs text-danger-fg">{error}</span>}
    </div>
  )
}
