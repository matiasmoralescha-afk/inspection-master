import { cn } from '@/lib/utils'
import { MODE_STYLES, type ShippingMode } from '@/lib/tokens'

const ZONE_STYLES: Record<string, string> = {
  Miami: 'bg-sky-100 text-sky-700', Texas: 'bg-amber-100 text-amber-700',
  'Los Angeles': 'bg-purple-100 text-purple-700', Oxnard: 'bg-emerald-100 text-emerald-700',
  'New Jersey': 'bg-rose-100 text-rose-700', 'New York': 'bg-indigo-100 text-indigo-700',
}

interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  mode?: ShippingMode
  zone?: string
  uppercase?: boolean
}

export function Tag({ mode, zone, uppercase, className, children, ...rest }: TagProps) {
  const isUpper = uppercase ?? !!mode
  const style = mode
    ? cn('ring-1 ring-inset', MODE_STYLES[mode])
    : zone
    ? (ZONE_STYLES[zone] ?? 'bg-surface-sunk text-ink-tertiary')
    : 'bg-surface-sunk text-ink-secondary'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-normal whitespace-nowrap',
        isUpper && 'uppercase tracking-label', style, className,
      )}
      {...rest}
    >
      {children ?? mode ?? zone}
    </span>
  )
}
