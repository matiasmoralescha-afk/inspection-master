export const STATUS = {
  ready:     { label: 'Ready',     tone: 'ok' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  pending:   { label: 'Pending',   tone: 'warn' },
  done:      { label: 'Done',      tone: 'neutral' },
} as const
export type ShipmentStatus = keyof typeof STATUS

export function gradeColor(grade?: string | null): string {
  if (!grade) return 'text-ink-muted'
  switch (grade[0].toUpperCase()) {
    case 'A': return 'text-emerald-600 dark:text-emerald-400'
    case 'B': return 'text-amber-500'
    case 'C': return 'text-orange-500'
    case 'D': return 'text-red-600 dark:text-red-400'
    default:  return 'text-ink-secondary'
  }
}

export const SHIPPING_MODES = ['ocean', 'air', 'terrestre', 'repack', 'rejection'] as const
export type ShippingMode = (typeof SHIPPING_MODES)[number]

export const MODE_STYLES: Record<ShippingMode, string> = {
  ocean:     'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300',
  air:       'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  terrestre: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300',
  repack:    'bg-purple-100 text-purple-700 ring-purple-200 dark:bg-purple-950 dark:text-purple-300',
  rejection: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300',
}

export const ZONES = ['Miami', 'Texas', 'Los Angeles', 'Oxnard', 'New Jersey', 'New York'] as const

export const HEX = {
  emerald:  '#059669',
  amber:    '#f59e0b',
  sky:      '#0ea5e9',
  red:      '#dc2626',
  orange:   '#f97316',
  blue:     '#2563eb',
  slate900: '#0f172a',
} as const
