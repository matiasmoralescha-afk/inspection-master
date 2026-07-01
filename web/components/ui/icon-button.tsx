import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icon'

const SIZES = { sm: 'h-7 w-7', md: 'h-8 w-8', lg: 'h-9 w-9' } as const
const ICON = { sm: 14, md: 16, lg: 18 } as const

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  size?: keyof typeof SIZES
  variant?: 'bordered' | 'plain'
  'aria-label': string
}

export function IconButton({
  icon, size = 'md', variant = 'bordered', className, ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-lg text-ink-tertiary transition-colors',
        'hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        'disabled:opacity-40 disabled:pointer-events-none',
        variant === 'bordered'
          ? 'border border-hairline bg-surface hover:border-hairline-strong'
          : 'border border-transparent hover:bg-surface-muted',
        SIZES[size], className,
      )}
      {...rest}
    >
      <Icon name={icon} size={ICON[size]} />
    </button>
  )
}
