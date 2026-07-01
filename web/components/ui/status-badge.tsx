import { cn } from '@/lib/utils'
import { STATUS, type ShipmentStatus } from '@/lib/tokens'
import { Badge } from './badge'

const TONE_MAP = { ready: 'ok', scheduled: 'info', pending: 'warn', done: 'neutral' } as const

interface StatusBadgeProps {
  status?: ShipmentStatus
  label?: string
  className?: string
}

export function StatusBadge({ status = 'pending', label, className }: StatusBadgeProps) {
  return (
    <Badge tone={TONE_MAP[status]} dot className={className}>
      {label ?? STATUS[status].label}
    </Badge>
  )
}
