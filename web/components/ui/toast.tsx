import { cn } from '@/lib/utils'

export type NotificationEvent =
  | 'ready_for_inspection' | 'report_received' | 'reinspection_due' | 'eta_overdue'

const EVENTS: Record<NotificationEvent, { emoji: string; title: string; border: string }> = {
  ready_for_inspection: { emoji: '🟢', title: 'Listo para inspección', border: 'border-l-emerald-500' },
  report_received:      { emoji: '✅', title: 'Reporte recibido',       border: 'border-l-sky-500' },
  reinspection_due:     { emoji: '⚠️', title: 'Reinspección vence hoy', border: 'border-l-amber-500' },
  eta_overdue:          { emoji: '🔴', title: 'ETA pasada sin inspeccionar', border: 'border-l-red-500' },
}

interface ToastProps {
  event?: NotificationEvent
  title?: string
  message?: string
  onDismiss?: () => void
}

export function Toast({ event = 'ready_for_inspection', title, message, onDismiss }: ToastProps) {
  const e = EVENTS[event]
  return (
    <div
      role="status"
      className={cn(
        'flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-l-4 border-hairline bg-surface p-4 shadow-lg',
        e.border,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-primary">
          <span className="mr-1.5">{e.emoji}</span>{title ?? e.title}
        </p>
        {message && <p className="mt-0.5 truncate text-sm text-ink-tertiary">{message}</p>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Cerrar" className="mt-0.5 shrink-0 text-lg leading-none text-ink-muted">
          ✕
        </button>
      )}
    </div>
  )
}
