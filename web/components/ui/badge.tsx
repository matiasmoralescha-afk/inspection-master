import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'ok' | 'warn' | 'info' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-sunk text-ink-tertiary ring-hairline',
  ok:      'bg-ok-bg text-ok-fg ring-ok-border',
  warn:    'bg-warn-bg text-warn-fg ring-warn-border',
  info:    'bg-info-bg text-info-fg ring-info-border',
  danger:  'bg-danger-bg text-danger-fg ring-danger-border',
}
const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-muted', ok: 'bg-ok-solid', warn: 'bg-warn-solid',
  info: 'bg-info-solid', danger: 'bg-danger-solid',
}

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  dot?: boolean
  solid?: boolean
  uppercase?: boolean
}

export function Badge({
  tone = 'neutral', dot, solid, uppercase = true, className, children, ...rest
}: BadgeProps) {
  if (solid) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-accent-ink px-2 py-0.5 text-xs font-bold text-surface', className)} {...rest}>
        {children}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-none ring-1 ring-inset',
        uppercase && 'uppercase tracking-wide', TONES[tone], className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  )
}
