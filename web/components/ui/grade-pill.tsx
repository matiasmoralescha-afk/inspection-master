import { cn } from '@/lib/utils'
import { gradeColor } from '@/lib/tokens'

interface GradePillProps {
  grade?: string | null
  chip?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const CHIP_BG: Record<string, string> = {
  A: 'bg-ok-bg ring-ok-border', B: 'bg-warn-bg ring-warn-border',
  C: 'bg-warn-bg ring-warn-border', D: 'bg-danger-bg ring-danger-border',
}

export function GradePill({ grade, chip, size = 'md', className }: GradePillProps) {
  const color = gradeColor(grade)
  const key = grade?.[0]?.toUpperCase() ?? ''

  if (chip) {
    return (
      <span className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-sm font-bold ring-1 ring-inset',
        color, CHIP_BG[key] ?? 'bg-surface-sunk ring-hairline', className,
      )}>
        {grade || '—'}
      </span>
    )
  }
  return (
    <span className={cn(
      'font-semibold tabular-nums', color,
      size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base',
      !grade && 'font-normal text-ink-muted', className,
    )}>
      {grade || '—'}
    </span>
  )
}
