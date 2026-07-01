import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icon'

type Variant = 'primary' | 'ink' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:   'bg-accent text-white hover:bg-accent-hover border border-transparent',
  ink:       'bg-accent-ink text-surface hover:bg-slate-700 border border-transparent',
  secondary: 'bg-surface text-ink-secondary border border-hairline hover:border-hairline-strong hover:text-ink-primary',
  ghost:     'bg-transparent text-ink-tertiary border border-transparent hover:bg-surface-muted hover:text-ink-primary',
  danger:    'bg-surface text-rose-600 border border-rose-200 hover:bg-danger-bg dark:border-rose-900',
}
const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-base gap-1.5',
  lg: 'px-5 py-2.5 text-md gap-2',
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
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        'disabled:opacity-50 disabled:pointer-events-none',
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
