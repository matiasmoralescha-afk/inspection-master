import { cn } from '@/lib/utils'

type Accent = 'ok' | 'warn' | 'info' | 'danger' | 'neutral'
const ACCENTS: Record<Accent, string> = {
  ok: 'bg-ok-solid', warn: 'bg-warn-solid', info: 'bg-info-solid',
  danger: 'bg-danger-solid', neutral: 'bg-hairline',
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  accent?: Accent
  pad?: boolean
}

export function Card({
  interactive, accent, pad = true, className, children, ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-hairline bg-surface text-left',
        pad && 'p-4',
        interactive && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
      {...rest}
    >
      {accent && <span className={cn('absolute inset-x-0 top-0 h-0.5', ACCENTS[accent])} />}
      {children}
    </div>
  )
}
