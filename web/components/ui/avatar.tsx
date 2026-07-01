import { cn } from '@/lib/utils'

type Tone = 'emerald' | 'sky' | 'amber' | 'purple' | 'rose' | 'indigo' | 'slate'

const TONES: Record<Tone, string> = {
  emerald: 'bg-emerald-100 text-emerald-700', sky: 'bg-sky-500 text-white',
  amber: 'bg-amber-100 text-amber-700', purple: 'bg-purple-100 text-purple-700',
  rose: 'bg-rose-100 text-rose-700', indigo: 'bg-indigo-100 text-indigo-700',
  slate: 'bg-surface-sunk text-ink-secondary',
}
const CYCLE: Tone[] = ['emerald', 'sky', 'amber', 'purple', 'rose', 'indigo']
const SIZES = { sm: 'h-7 w-7 text-xs', md: 'h-8 w-8 text-sm', lg: 'h-9 w-9 text-sm', xl: 'h-11 w-11 text-md' }

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '—'
}

interface AvatarProps {
  name: string
  tone?: Tone
  size?: keyof typeof SIZES
  className?: string
}

export function Avatar({ name, tone, size = 'md', className }: AvatarProps) {
  const key = tone ?? CYCLE[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % CYCLE.length]
  return (
    <span aria-hidden className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none',
      TONES[key], SIZES[size], className,
    )}>
      {initials(name)}
    </span>
  )
}
