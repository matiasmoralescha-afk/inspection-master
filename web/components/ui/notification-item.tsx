import { cn } from '@/lib/utils'
import type { NotificationEvent } from './toast'

const EMOJI: Record<NotificationEvent, string> = {
  ready_for_inspection: '🟢', report_received: '✅', reinspection_due: '⚠️', eta_overdue: '🔴',
}

interface NotificationItemProps {
  event?: NotificationEvent
  message?: string
  time?: string
  className?: string
}

export function NotificationItem({
  event = 'ready_for_inspection', message, time, className,
}: NotificationItemProps) {
  return (
    <div className={cn('flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-muted', className)}>
      <span className="mt-0.5 shrink-0 text-base leading-none">{EMOJI[event]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-ink-secondary">{message}</p>
        {time && <p className="mt-0.5 text-xs text-ink-muted">{time}</p>}
      </div>
    </div>
  )
}
