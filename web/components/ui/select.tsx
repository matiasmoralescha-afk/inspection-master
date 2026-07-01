import { cn } from '@/lib/utils'
import { Icon } from './icon'

type Option = string | { value: string; label: string }

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options?: Option[]
  placeholder?: string
}

export function Select({ label, options = [], placeholder, className, id, ...rest }: SelectProps) {
  const selId = id ?? (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined)
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={selId} className="text-xs font-medium text-ink-tertiary">{label}</label>}
      <div className="relative flex">
        <select
          id={selId}
          className={cn(
            'w-full appearance-none rounded-lg border border-hairline bg-surface py-2 pl-3 pr-8 text-base text-ink-primary outline-none',
            'transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50', className,
          )}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o
            return <option key={opt.value} value={opt.value}>{opt.label}</option>
          })}
        </select>
        <Icon name="chevronDown" size={12} strokeWidth={2.5}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" />
      </div>
    </div>
  )
}
