import { cn } from '@/lib/utils'

type Tone = 'slate' | 'blue' | 'emerald' | 'amber' | 'red'

const NUM: Record<Tone, string> = {
  slate: 'text-ink-primary', blue: 'text-sky-600', emerald: 'text-emerald-600',
  amber: 'text-amber-600', red: 'text-red-600',
}
const DOT: Record<Tone, string> = {
  slate: 'bg-ink-muted', blue: 'bg-sky-400', emerald: 'bg-emerald-400',
  amber: 'bg-amber-400', red: 'bg-red-500',
}

interface StatCardProps {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: Tone
  className?: string
}

export function StatCard({ label, value, hint, tone = 'slate', className }: StatCardProps) {
  return (
    <div className={cn('rounded-xl border border-hairline bg-surface px-4 py-3', className)}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-label text-ink-muted">{label}</span>
        <span className={cn('h-2 w-2 rounded-full', DOT[tone])} />
      </div>
      <div className={cn('text-2xl font-semibold leading-tight tabular-nums', NUM[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  )
}
