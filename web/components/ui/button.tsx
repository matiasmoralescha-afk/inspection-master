import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icon'

type Variant = 'primary' | 'ink' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:   'bg-accent text-white border border-transparent shadow-sm hover:bg-accent-hover hover:shadow',
  ink:       'bg-accent-ink text-surface border border-transparent shadow-sm hover:bg-slate-700 hover:shadow',
  secondary: 'bg-surface text-ink-secondary border border-hairline shadow-sm hover:border-hairline-strong hover:bg-surface-muted hover:text-ink-primary',
  ghost:     'bg-transparent text-ink-tertiary border border-transparent hover:bg-surface-muted hover:text-ink-primary',
  danger:    'bg-surface text-rose-600 border border-rose-200 shadow-sm hover:bg-danger-bg hover:border-rose-300 dark:border-rose-900',
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-4 text-base gap-1.5',
  lg: 'h-10 px-5 text-md gap-2',
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  iconRight?: IconName
}

export function Button({
  variant = 'primary', size = 'md', icon, iconRight,
  className, children, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold leading-none',
        'transition-all duration-150 active:translate-y-px active:shadow-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
        'disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 16 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'lg' ? 16 : 14} />}
    </button>
  )
}
