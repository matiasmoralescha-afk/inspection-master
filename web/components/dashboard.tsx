'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { Shipment, DbNotification, Staff } from '@/lib/types'
import { supabase } from '@/lib/supabase'

// ─── theme ────────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    // Light (white) is the default — dark only if explicitly saved.
    const isDark = localStorage.getItem('eqa-theme') === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  function toggle() {
    setDark(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('eqa-theme', next ? 'dark' : 'light')
      return next
    })
  }

  return { dark, toggle }
}

function ThemeToggle({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Modo claro' : 'Modo oscuro'}
      title={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="rounded-lg border border-hairline bg-surface p-1.5 text-ink-tertiary hover:text-gray-900 dark:hover:text-slate-100 transition-colors"
    >
      {dark ? (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  )
}

// ─── toast notifications ─────────────────────────────────────────────────────

type Toast = { id: number; event_type: DbNotification['event_type']; message: string }

const EVENT_LABELS: Record<DbNotification['event_type'], string> = {
  ready_for_inspection: '🟢 Listo para inspección',
  report_received:      '✅ Reporte recibido',
  reinspection_due:     '⚠️ Reinspección vence hoy',
  eta_overdue:          '🔴 ETA pasada sin inspeccionar',
}

const EVENT_COLORS: Record<DbNotification['event_type'], string> = {
  ready_for_inspection: 'border-l-emerald-500',
  report_received:      'border-l-blue-500',
  reinspection_due:     'border-l-amber-500',
  eta_overdue:          'border-l-red-500',
}

function ToastList({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 shadow-lg border-l-4 ${EVENT_COLORS[t.event_type]}`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-gray-800 dark:text-slate-100">{EVENT_LABELS[t.event_type]}</p>
            <p className="text-[12px] text-ink-tertiary mt-0.5 truncate">{t.message}</p>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Cerrar notificacion"
            className="text-gray-400 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-200 text-lg leading-none shrink-0 mt-0.5"
          >✕</button>
        </div>
      ))}
    </div>
  )
}

function useRealtimeNotifications(onShipmentChange: () => void) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const n = payload.new as DbNotification
          const toast: Toast = {
            id:         n.id,
            event_type: n.event_type,
            message:    n.message ?? '',
          }
          setToasts(prev => [toast, ...prev].slice(0, 5))
          setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toast.id)), 8000)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shipments' },
        () => { onShipmentChange() },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [onShipmentChange])

  return { toasts, dismiss }
}

// ─── profile persistence ──────────────────────────────────────────────────────

const PROFILE_KEY = 'eqa-dashboard-v1'

function loadProfile(): { order: string[]; visible: string[] } | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(PROFILE_KEY) : null
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveProfile(order: string[], visible: string[]): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ order, visible })) } catch {}
}

function mergeOrder(stored: string[]): string[] {
  const current = COLUMNS.map(c => c.key)
  const valid   = stored.filter(k => current.includes(k))
  const missing = current.filter(k => !valid.includes(k))
  return [...valid, ...missing]
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function effectiveDate(s: Shipment): string | null {
  return s.dia_disponible_para_inspeccion ?? s.eta_fecha ?? null
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[+m - 1]} ${d}, ${y}`
}

function gradeColor(grade: string | null | undefined): string {
  if (!grade) return 'text-ink-muted'
  if (grade.startsWith('A')) return 'text-emerald-600 dark:text-emerald-400 font-semibold'
  if (grade.startsWith('B')) return 'text-amber-500 dark:text-amber-400 font-semibold'
  if (grade.startsWith('C')) return 'text-orange-500 dark:text-orange-400 font-semibold'
  if (grade.startsWith('D')) return 'text-red-600 dark:text-red-400 font-semibold'
  return 'text-gray-600 dark:text-slate-400'
}

const SHIPMENT_SELECT = '*, inspector:staff(id,name,role,zone)'

const ESTADO_OPTIONS = [
  { value: 'abierto', label: 'Abierto' },
  { value: 'cerrado', label: 'Cerrado' },
] as const

const INSPECTION_STATUS_OPTIONS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'programada', label: 'Programada' },
  { value: 'completada', label: 'Completada' },
] as const

const TIPO_CARGA_OPTIONS = [
  { value: 'ocean', label: 'Ocean' },
  { value: 'air', label: 'Air' },
  { value: 'truck', label: 'Truck' },
] as const

function toNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function toNullableNumber(value: string | null | undefined): number | null {
  const normalized = value?.trim()
  if (!normalized) return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function normalizeClientName(raw: string): string {
  return raw.trim().toUpperCase()
}

// Keep in sync with agent/normalizers.py:normalize_unit_id — same placeholder
// set, since the agent is the authority for what lookup_key a shipment gets.
const INVALID_UNIT_IDS = new Set(['DELIVERY', 'N/A', 'NA', 'TBD', 'TBC', 'REJECT'])

function normalizeUnitId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  const cleaned = normalized.replace(/[\s.-]+/g, '').toUpperCase()
  if (!cleaned || INVALID_UNIT_IDS.has(cleaned)) return null
  return cleaned
}

// Keep in sync with agent/normalizers.py:normalize_po's _PO_PLACEHOLDERS.
const PO_PLACEHOLDERS = new Set(['PO', 'N/A', 'NA', 'TBD', 'TBC'])

function normalizePo(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase()
  if (!normalized) return null
  return PO_PLACEHOLDERS.has(normalized) ? null : normalized
}

function buildLookupKey(shipment: Pick<Shipment, 'cliente' | 'cliente_norm' | 'unit_id' | 'unit_id_norm' | 'po' | 'po_norm' | 'lookup_key'>): string {
  if (shipment.lookup_key) return shipment.lookup_key
  const clienteNorm = shipment.cliente_norm || normalizeClientName(shipment.cliente)
  const unitNorm = shipment.unit_id_norm ?? normalizeUnitId(shipment.unit_id)
  const poNorm = shipment.po_norm ?? normalizePo(shipment.po)
  return `${clienteNorm}|${unitNorm ?? ''}|${poNorm ?? ''}`
}

function withDerivedShipmentFields(base: Shipment, patch: Partial<Shipment>): Partial<Shipment> {
  const next = { ...base, ...patch }
  const derived: Partial<Shipment> = {
    ultima_actualizacion: new Date().toISOString(),
  }

  if ('cliente' in patch) derived.cliente_norm = normalizeClientName(next.cliente)
  if ('unit_id' in patch) derived.unit_id_norm = normalizeUnitId(next.unit_id)
  if ('po' in patch) derived.po_norm = normalizePo(next.po)

  return { ...patch, ...derived }
}

type NewShipmentForm = {
  cliente: string
  tipo_carga: string
  location: string
  unit_id: string
  po: string
  commodity: string
  shipper: string
  country_of_origin: string
  eta_fecha: string
  dia_disponible_para_inspeccion: string
  inspection_status: string
  estado_general: string
  ready_for_inspection: boolean
  pallets: string
  comments_raw: string
}

const EMPTY_NEW_SHIPMENT: NewShipmentForm = {
  cliente: '',
  tipo_carga: 'ocean',
  location: '',
  unit_id: '',
  po: '',
  commodity: '',
  shipper: '',
  country_of_origin: '',
  eta_fecha: '',
  dia_disponible_para_inspeccion: '',
  inspection_status: 'pendiente',
  estado_general: 'abierto',
  ready_for_inspection: false,
  pallets: '',
  comments_raw: '',
}

// ─── column definitions ──────────────────────────────────────────────────────

type Col = {
  key: string
  label: string
  defaultVisible: boolean
  getValue: (s: Shipment) => string
  render: (s: Shipment) => React.ReactNode
  tdClass?: string
}

const COLUMNS: Col[] = [
  {
    key: 'po', label: 'PO', defaultVisible: true,
    getValue: s => s.po ?? '',
    render: s => <span className="font-mono text-[13px] font-medium text-ink-primary">{s.po ?? '—'}</span>,
  },
  {
    key: 'unit_id', label: 'Container', defaultVisible: true,
    getValue: s => s.unit_id ?? '',
    render: s => <span className="font-mono text-[13px] text-ink-secondary">{s.unit_id ?? '—'}</span>,
  },
  {
    key: 'commodity', label: 'Commodity', defaultVisible: true,
    getValue: s => s.commodity ?? '',
    render: s => <span className="text-[13px] text-ink-secondary">{s.commodity ?? '—'}</span>,
  },
  {
    key: 'location', label: 'Location', defaultVisible: true,
    getValue: s => s.location ?? '',
    render: s => s.location
      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-surface-sunk text-ink-secondary">{s.location}</span>
      : <span className="text-gray-300 dark:text-slate-600">—</span>,
  },
  {
    key: 'shipper', label: 'Warehouse', defaultVisible: true,
    getValue: s => s.shipper ?? '',
    render: s => <span className="text-[13px] text-ink-tertiary max-w-[160px] truncate block">{s.shipper ?? '—'}</span>,
    tdClass: 'max-w-[160px]',
  },
  {
    key: 'country_of_origin', label: 'Origin', defaultVisible: true,
    getValue: s => s.country_of_origin ?? '',
    render: s => <span className="text-[13px] text-ink-tertiary">{s.country_of_origin ?? '—'}</span>,
  },
  {
    key: 'cliente', label: 'Client', defaultVisible: true,
    getValue: s => s.cliente ?? '',
    render: s => <span className="text-[13px] font-medium text-ink-secondary">{s.cliente}</span>,
  },
  {
    key: 'vessel', label: 'Carrier', defaultVisible: false,
    getValue: s => s.vessel ?? '',
    render: s => <span className="text-[13px] text-ink-muted uppercase tracking-wide">{s.vessel ? 'OCEAN' : '—'}</span>,
  },
  {
    key: 'bl', label: 'BL#', defaultVisible: false,
    getValue: s => s.bl ?? '',
    render: s => <span className="font-mono text-[12px] text-ink-muted">{s.bl ?? '—'}</span>,
  },
  {
    key: 'dia_disponible', label: 'Inspection Date', defaultVisible: true,
    getValue: s => effectiveDate(s) ?? '',
    render: s => <InspDateCell s={s} />,
  },
  {
    key: 'pallets', label: 'Pallets', defaultVisible: true,
    getValue: s => s.pallets != null ? String(s.pallets) : '',
    render: s => <span className="text-[13px] text-gray-600 dark:text-slate-400">{s.pallets ?? '—'}</span>,
    tdClass: 'text-right',
  },
  {
    key: 'overall_grade', label: 'Grade', defaultVisible: true,
    getValue: s => s.overall_grade ?? '',
    render: s => s.report_url
      ? <a href={s.report_url} target="_blank" rel="noopener noreferrer"
           className={`${gradeColor(s.overall_grade)} text-[13px] hover:underline`}>
          {s.overall_grade ?? '—'}
        </a>
      : <span className={`text-[13px] ${gradeColor(s.overall_grade)}`}>{s.overall_grade ?? '—'}</span>,
  },
  {
    key: 'reinspection_due_date', label: 'Reinsp.', defaultVisible: true,
    getValue: s => s.reinspection_due_date ?? '',
    render: s => <ReinspCell date={s.reinspection_due_date} estado={s.estado_general} />,
  },
  {
    key: 'inspector', label: 'Inspector', defaultVisible: false,
    getValue: s => s.inspector_id ? 'asignado' : '',
    render: s => s.inspector_id
      ? <span className="inline-flex items-center gap-1 text-[13px] text-gray-600 dark:text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0" />Asignado</span>
      : <span className="text-gray-300 dark:text-slate-600 text-[13px]">—</span>,
  },
  {
    key: 'estado_general', label: 'Status', defaultVisible: true,
    getValue: s => s.estado_general ?? '',
    render: s => <StatusBadge s={s} />,
  },
]

// ─── cell components ──────────────────────────────────────────────────────────

function InspDateCell({ s }: { s: Shipment }) {
  const eff = effectiveDate(s)
  if (!eff) return <span className="text-gray-300 dark:text-slate-600 text-[13px]">—</span>
  const today = new Date().toISOString().slice(0, 10)
  const label = fmtDate(eff)
  if (eff < today)  return <span className="text-[13px] text-red-500 dark:text-red-400 font-medium">{label}</span>
  if (eff === today) return <span className="text-[13px] text-amber-600 dark:text-amber-400 font-semibold">{label} ●</span>
  return <span className="text-[13px] text-ink-secondary">{label}</span>
}

function ReinspCell({ date, estado }: { date: string | null; estado: string }) {
  if (!date || estado === 'cerrado') return <span className="text-gray-300 dark:text-slate-600 text-[13px]">—</span>
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const label = fmtDate(date)
  if (date < today)  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">⚠ {label}</span>
  if (date === today) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">HOY</span>
  if (date === tomorrow) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">Mañana</span>
  return <span className="text-[13px] text-ink-tertiary">{label}</span>
}

function StatusBadge({ s }: { s: Shipment }) {
  if (s.estado_general === 'cerrado') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-sunk px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-slate-500" />
        Done
      </span>
    )
  }
  if (s.ready_for_inspection === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Ready
      </span>
    )
  }
  if (s.inspection_status === 'programada') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-400">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        Scheduled
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Pending
    </span>
  )
}

// ─── filter chip ──────────────────────────────────────────────────────────────

function Chip({
  label, value, options, onChange, isSearch = false,
}: {
  label: string
  value: string
  options?: string[]
  onChange: (v: string) => void
  isSearch?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const isActive = !!value

  if (isSearch) {
    return (
      <div className="relative flex items-center">
        <svg className="pointer-events-none absolute left-3 h-4 w-4 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>
        <input
          type="text"
          placeholder={label}
          aria-label={label}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full min-w-[200px] rounded-lg border border-hairline bg-surface py-2 pl-9 pr-4 text-[13px] text-gray-700 dark:text-slate-200 placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none transition focus:border-gray-400 dark:focus:border-slate-500 focus:ring-2 focus:ring-gray-100 dark:focus:ring-slate-700 sm:w-52"
        />
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
          isActive
            ? 'border-gray-900 dark:border-slate-200 bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900'
            : 'border-hairline bg-surface text-ink-secondary hover:border-gray-300 dark:hover:border-slate-600 hover:text-gray-900 dark:hover:text-slate-100'
        }`}
      >
        {isActive ? `${label}: ${value}` : label}
        <svg className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && options && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[160px] rounded-xl border border-hairline bg-surface p-1.5 shadow-lg">
          <button
            onClick={() => { onChange(''); setOpen(false) }}
            className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink-muted hover:bg-surface-muted"
          >
            Todos
          </button>
          {options.map(o => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false) }}
              className={`w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-muted ${
                value === o ? 'text-ink-primary font-medium' : 'text-ink-secondary'
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── column picker ────────────────────────────────────────────────────────────

function ColPicker({ visible, onChange, onResetOrder }: { visible: Set<string>; onChange: (k: string, on: boolean) => void; onResetOrder?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] font-medium text-ink-secondary hover:border-gray-300 dark:hover:border-slate-600"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Columnas
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-hairline bg-surface p-2 shadow-lg">
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">Columnas</p>
          <div className="space-y-0.5 max-h-72 overflow-y-auto">
            {COLUMNS.map(col => (
              <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-ink-secondary hover:bg-surface-muted">
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  onChange={e => onChange(col.key, e.target.checked)}
                  className="rounded border-gray-300 dark:border-slate-600 w-3.5 h-3.5"
                />
                {col.label}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2 border-t border-hairline pt-2">
            <button onClick={() => COLUMNS.forEach(c => onChange(c.key, true))} className="text-[12px] text-blue-600 dark:text-blue-400 hover:underline">Todas</button>
            <span className="text-gray-300 dark:text-slate-600">·</span>
            <button onClick={() => COLUMNS.forEach(c => onChange(c.key, c.defaultVisible))} className="text-[12px] text-ink-muted hover:underline">Reset cols</button>
            {onResetOrder && (
              <>
                <span className="text-gray-300 dark:text-slate-600">·</span>
                <button onClick={onResetOrder} className="text-[12px] text-ink-muted hover:underline">Reset orden</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── stat cards ───────────────────────────────────────────────────────────────

type StatTone = 'amber' | 'blue' | 'emerald' | 'slate'

function StatCard({ hint, label, tone, value }: { hint: string; label: string; tone: StatTone; value: number }) {
  const dotMap: Record<StatTone, string> = {
    amber:   'bg-amber-400',
    blue:    'bg-sky-400',
    emerald: 'bg-emerald-400',
    slate:   'bg-gray-400 dark:bg-slate-500',
  }
  const numMap: Record<StatTone, string> = {
    amber:   'text-amber-600 dark:text-amber-400',
    blue:    'text-sky-600 dark:text-sky-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    slate:   'text-ink-secondary',
  }
  return (
    <div className="rounded-xl border border-hairline/60 bg-surface px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{label}</p>
        <span className={`h-2 w-2 rounded-full ${dotMap[tone]}`} />
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${numMap[tone]}`}>{value}</p>
      <p className="text-[11px] text-ink-muted mt-0.5">{hint}</p>
    </div>
  )
}

// ─── detail panel ─────────────────────────────────────────────────────────────

function CreateShipmentModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (form: NewShipmentForm) => Promise<void>
}) {
  const [form, setForm] = useState<NewShipmentForm>(EMPTY_NEW_SHIPMENT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_NEW_SHIPMENT)
    setError(null)
    setSaving(false)
  }, [open])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!form.cliente.trim()) {
      setError('El cliente es obligatorio para crear la inspección.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await onCreate(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la inspección.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nueva inspección"
      onClose={saving ? undefined : onClose}
      width={860}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="shipment-create-form" icon="plus" disabled={saving}>
            {saving ? 'Creando…' : 'Crear inspección'}
          </Button>
        </>
      )}
    >
      <form id="shipment-create-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-hairline bg-surface-sunk px-4 py-3 text-sm text-ink-tertiary">
          La app genera automáticamente `cliente_norm`, `unit_id_norm`, `po_norm` y `lookup_key` para que el registro quede consistente.
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">Base</p>
            <h3 className="mt-1 text-base font-semibold text-ink-primary">Datos principales</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Cliente"
              required
              value={form.cliente}
              onChange={event => setForm(prev => ({ ...prev, cliente: event.target.value }))}
            />
            <Select
              label="Tipo de carga"
              value={form.tipo_carga}
              options={TIPO_CARGA_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
              onChange={event => setForm(prev => ({ ...prev, tipo_carga: event.target.value }))}
            />
            <Input
              label="Container"
              value={form.unit_id}
              onChange={event => setForm(prev => ({ ...prev, unit_id: event.target.value }))}
            />
            <Input
              label="PO"
              value={form.po}
              onChange={event => setForm(prev => ({ ...prev, po: event.target.value }))}
            />
            <Input
              label="Commodity"
              value={form.commodity}
              onChange={event => setForm(prev => ({ ...prev, commodity: event.target.value }))}
            />
            <Input
              label="Location"
              value={form.location}
              onChange={event => setForm(prev => ({ ...prev, location: event.target.value }))}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">Operación</p>
            <h3 className="mt-1 text-base font-semibold text-ink-primary">Logística inicial</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Warehouse / Shipper"
              value={form.shipper}
              onChange={event => setForm(prev => ({ ...prev, shipper: event.target.value }))}
            />
            <Input
              label="País de origen"
              value={form.country_of_origin}
              onChange={event => setForm(prev => ({ ...prev, country_of_origin: event.target.value }))}
            />
            <Input
              label="ETA"
              type="date"
              value={form.eta_fecha}
              onChange={event => setForm(prev => ({ ...prev, eta_fecha: event.target.value }))}
            />
            <Input
              label="Día disponible"
              type="date"
              value={form.dia_disponible_para_inspeccion}
              onChange={event => setForm(prev => ({ ...prev, dia_disponible_para_inspeccion: event.target.value }))}
            />
            <Input
              label="Pallets"
              type="number"
              min="0"
              value={form.pallets}
              onChange={event => setForm(prev => ({ ...prev, pallets: event.target.value }))}
            />
            <Select
              label="Estatus de inspección"
              value={form.inspection_status}
              options={INSPECTION_STATUS_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
              onChange={event => setForm(prev => ({ ...prev, inspection_status: event.target.value }))}
            />
          </div>
        </section>

        <section className="grid gap-4 rounded-xl border border-hairline bg-surface-sunk px-4 py-4 sm:grid-cols-2">
          <Switch
            checked={form.ready_for_inspection}
            onChange={next => setForm(prev => ({ ...prev, ready_for_inspection: next }))}
            label={form.ready_for_inspection ? 'Marcada como lista para inspección' : 'Aún no está lista para inspección'}
          />
          <Select
            label="Estado general"
            value={form.estado_general}
            options={ESTADO_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
            onChange={event => setForm(prev => ({ ...prev, estado_general: event.target.value }))}
          />
        </section>

        <div className="flex flex-col gap-1">
          <label htmlFor="shipment-create-comments" className="text-xs font-medium text-ink-tertiary">Comentarios</label>
          <textarea
            id="shipment-create-comments"
            rows={4}
            value={form.comments_raw}
            onChange={event => setForm(prev => ({ ...prev, comments_raw: event.target.value }))}
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-base text-ink-primary outline-none transition-colors placeholder:text-ink-muted focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            placeholder="Notas iniciales, instrucciones o contexto del embarque"
          />
        </div>
      </form>
    </Modal>
  )
}

function DetailPanel({ s, onClose }: { s: Shipment; onClose: (dirty: boolean) => void }) {
  const [local, setLocal] = useState<Shipment>(s)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { if (!dirty) setLocal(s) }, [s, dirty])

  const today = new Date().toISOString().slice(0, 10)
  const eff = effectiveDate(local)

  async function savePatch(rawPatch: Partial<Shipment>, label: string): Promise<boolean> {
    const previous = local
    const patch = withDerivedShipmentFields(previous, rawPatch)
    const optimistic = { ...previous, ...patch } as Shipment

    setSaving(label)
    setSaveError(null)
    setLocal(optimistic)

    // Only re-fetch the joined inspector row when the edit could actually
    // change it — every other single-field edit doesn't need that round-trip.
    const needsInspectorJoin = 'inspector_id' in patch
    const query = supabase.from('shipments').update(patch).eq('id', previous.id)
    const { data, error } = needsInspectorJoin
      ? await query.select(SHIPMENT_SELECT).single()
      : await query.select('*').single()

    if (error) {
      setLocal(previous)
      setSaveError(error.message)
      setSaving(null)
      return false
    }

    setLocal(needsInspectorJoin ? (data as Shipment) : ({ ...data, inspector: previous.inspector } as Shipment))
    setDirty(true)
    setSaving(null)
    return true
  }

  function save(field: keyof Shipment, value: unknown) {
    return savePatch({ [field]: value } as Partial<Shipment>, field)
  }

  function sv(field: keyof Shipment) {
    return (value: string | null) => save(field, value)
  }

  async function handleDelete() {
    setDeleting(true)
    const { error } = await supabase.from('shipments').delete().eq('id', local.id)

    if (error) {
      setSaveError(error.message)
      setDeleting(false)
      return
    }

    setDeleting(false)
    setDeleteOpen(false)
    onClose(true)
  }

  const lookupKey = buildLookupKey(local)

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm dark:bg-black/50" onClick={() => onClose(dirty)}>
        <div
          className="flex h-full w-full max-w-[44rem] flex-col overflow-y-auto bg-surface shadow-2xl"
          onClick={event => event.stopPropagation()}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline bg-gray-50 px-5 py-4 dark:bg-slate-800/50">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{local.cliente}</p>
              <h2 className="mt-0.5 truncate font-mono text-base font-bold text-ink-primary">{local.unit_id ?? local.po ?? '—'}</h2>
              <p className="mt-1 text-[12px] text-ink-muted">
                {local.po ? `PO ${local.po}` : 'Sin PO'} · actualizada {timeAgo(local.ultima_actualizacion)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {saving && <span className="text-[11px] text-ink-muted animate-pulse">Guardando…</span>}
              {dirty && !saving && <span className="text-[11px] text-emerald-500">✓ Guardado</span>}
              <Button size="sm" variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
                Eliminar
              </Button>
              <button
                aria-label="Cerrar panel"
                onClick={() => onClose(dirty)}
                className="text-lg leading-none text-ink-muted hover:text-gray-700 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-3">
            <StatusBadge s={local} />
            {eff && (
              <span className={`text-[13px] ${eff < today ? 'font-medium text-red-500 dark:text-red-400' : eff === today ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-ink-tertiary'}`}>
                {eff === today ? 'Hoy · ' : ''}{fmtDate(eff)}
              </span>
            )}
            {local.location && (
              <span className="ml-auto rounded bg-surface-sunk px-2 py-0.5 text-[11px] font-medium text-ink-secondary">{local.location}</span>
            )}
          </div>

          <div className="flex-1 space-y-5 px-5 py-4">
            {saveError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                {saveError}
              </div>
            )}

            <div className="rounded-xl border border-hairline bg-surface-sunk px-4 py-3 text-sm text-ink-tertiary">
              Toca `PO`, `Container` o cualquier campo para editarlo. Los campos normalizados se recalculan automáticamente.
            </div>

            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Estado</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <EField label="Estado general" value={local.estado_general} onSave={sv('estado_general')} options={ESTADO_OPTIONS.map(option => ({ value: option.value, label: option.label }))} />
                <EField label="Inspección" value={local.inspection_status} onSave={sv('inspection_status')} options={INSPECTION_STATUS_OPTIONS.map(option => ({ value: option.value, label: option.label }))} />
                <FlagField label="Listo para inspección" checked={local.ready_for_inspection === 1} onSave={next => save('ready_for_inspection', next ? 1 : 0)} />
                <FlagField label="Arribo confirmado" checked={local.warehouse_arrival_confirmed === 1} onSave={next => save('warehouse_arrival_confirmed', next ? 1 : 0)} />
                <FlagField label="Reporte enviado" checked={local.report_sent === 1} onSave={next => save('report_sent', next ? 1 : 0)} />
                <FlagField label="Requiere fumigación" checked={local.requiere_fumigacion === 1} onSave={next => save('requiere_fumigacion', next ? 1 : 0)} />
              </dl>
            </section>

            <section className="border-t border-hairline pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Identificación</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <EField label="Cliente" value={local.cliente} onSave={sv('cliente')} />
                <EField label="Tipo de carga" value={local.tipo_carga} onSave={sv('tipo_carga')} options={TIPO_CARGA_OPTIONS.map(option => ({ value: option.value, label: option.label }))} />
                <EField label="Location" value={local.location} onSave={sv('location')} />
                <EField label="Container" value={local.unit_id} onSave={sv('unit_id')} />
                <EField label="PO" value={local.po} onSave={sv('po')} />
                <EField label="BL#" value={local.bl} onSave={sv('bl')} />
                <EField label="Carrier" value={local.carrier} onSave={sv('carrier')} />
                <EField label="Buque" value={local.vessel} onSave={sv('vessel')} />
                <DetailKV label="Cliente norm" value={local.cliente_norm} mono />
                <DetailKV label="Container norm" value={local.unit_id_norm} mono />
                <DetailKV label="PO norm" value={local.po_norm} mono />
                <DetailKV label="Lookup key" value={lookupKey} mono />
              </dl>
            </section>

            <section className="border-t border-hairline pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Logística</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <EField label="Commodity" value={local.commodity} onSave={sv('commodity')} />
                <EField label="Descripción cantidad" value={local.quantity_description} onSave={sv('quantity_description')} />
                <EField label="Warehouse / Shipper" value={local.shipper} onSave={sv('shipper')} />
                <EField label="País de origen" value={local.country_of_origin} onSave={sv('country_of_origin')} />
                <EField label="ETA" value={local.eta_fecha} onSave={sv('eta_fecha')} type="date" />
                <EField label="Hora ETA" value={local.eta_hora} onSave={sv('eta_hora')} type="time" />
                <EField label="Día disponible" value={local.dia_disponible_para_inspeccion} onSave={sv('dia_disponible_para_inspeccion')} type="date" />
                <EField label="Arribo warehouse" value={local.warehouse_arrival_at} onSave={sv('warehouse_arrival_at')} />
                <EField label="Pallets" value={local.pallets != null ? String(local.pallets) : null} onSave={value => save('pallets', toNullableNumber(value))} type="number" />
                <EField label="Fuente" value={local.fuente} onSave={sv('fuente')} />
              </dl>
            </section>

            <section className="border-t border-hairline pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Cumplimiento</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <EField label="FDA" value={local.fda_status} onSave={sv('fda_status')} />
                <EField label="Customs" value={local.customs_status} onSave={sv('customs_status')} />
                <EField label="USDA" value={local.agriculture_usda_status} onSave={sv('agriculture_usda_status')} />
                <EField label="Fumigación" value={local.fumigation_status} onSave={sv('fumigation_status')} />
                <EField label="Fumigación completada" value={local.fumigation_completed_at} onSave={sv('fumigation_completed_at')} />
                <EField label="Reinspección vence" value={local.reinspection_due_date} onSave={sv('reinspection_due_date')} type="date" />
              </dl>
            </section>

            <section className="border-t border-hairline pt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Resultado</p>
                {local.overall_grade && <span className={`text-sm font-semibold ${gradeColor(local.overall_grade)}`}>Grade {local.overall_grade}</span>}
              </div>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <EField label="Grade" value={local.overall_grade} onSave={sv('overall_grade')} />
                <EField label="Fecha reporte" value={local.report_date} onSave={sv('report_date')} type="date" />
                <EField label="URL reporte" value={local.report_url} onSave={sv('report_url')} className="sm:col-span-2" />
                <EField label="Archivo PSI" value={local.psi_file} onSave={sv('psi_file')} className="sm:col-span-2" />
                <EField label="Condición" value={local.condition_text} onSave={sv('condition_text')} multiline className="sm:col-span-2" />
                <EField label="Calidad" value={local.quality_text} onSave={sv('quality_text')} multiline className="sm:col-span-2" />
              </dl>
            </section>

            <InspectorDropdown value={local.inspector_id} onSave={value => save('inspector_id', value)} />

            <section className="border-t border-hairline pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Notas</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3">
                <EField label="Lots" value={local.lots_raw} onSave={sv('lots_raw')} multiline className="sm:col-span-2" />
                <EField label="Comentarios" value={local.comments_raw} onSave={sv('comments_raw')} multiline className="sm:col-span-2" />
                <DetailKV label="Última actualización" value={local.ultima_actualizacion ? new Date(local.ultima_actualizacion).toLocaleString() : '—'} className="sm:col-span-2" />
              </dl>
            </section>
          </div>
        </div>
      </div>

      {deleteOpen && (
        <Modal
          title="¿Eliminar inspección?"
          onClose={() => setDeleteOpen(false)}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                Cancelar
              </Button>
              <Button variant="danger" icon="trash" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </>
          )}
        >
          <p className="text-sm text-ink-tertiary">
            Se eliminará la inspección de {local.cliente} con referencia {local.unit_id ?? local.po ?? `#${local.id}`}. Esta acción no se puede deshacer.
          </p>
        </Modal>
      )}
    </>
  )
}

function DetailKV({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 break-words text-[13px] text-ink-secondary ${mono ? 'font-mono text-[12px]' : ''}`}>{value || '—'}</dd>
    </div>
  )
}

// ─── editable field ───────────────────────────────────────────────────────────

type EFieldOption = { value: string; label: string }

function EField({
  label,
  value,
  onSave,
  type = 'text',
  options,
  multiline,
  className,
}: {
  label: string
  value: string | number | null | undefined
  onSave: (v: string | null) => void | Promise<boolean>
  type?: 'text' | 'date' | 'number' | 'time'
  options?: EFieldOption[]
  multiline?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? ''))

  useEffect(() => { if (!editing) setDraft(String(value ?? '')) }, [value, editing])

  function confirm() {
    setEditing(false)
    void onSave(draft.trim() || null)
  }

  function cancel() {
    setDraft(String(value ?? ''))
    setEditing(false)
  }

  function handleKey(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !multiline) confirm()
    if (event.key === 'Escape') cancel()
  }

  const inputCls = 'w-full rounded-lg border border-blue-300 bg-white px-2 py-1 text-[13px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-blue-600 dark:bg-slate-700 dark:text-slate-100'
  const hasValue = value != null && value !== ''

  return (
    <div className={`group ${className ?? ''}`}>
      <dt className="flex items-center gap-1 text-[11px] text-ink-muted">
        {label}
        {!editing && label && (
          <button
            type="button"
            onClick={event => { event.stopPropagation(); setEditing(true) }}
            className="inline-flex items-center gap-1 rounded-full border border-hairline px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-700 dark:hover:text-blue-400"
            title="Editar campo"
          >
            <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
            Editar
          </button>
        )}
      </dt>
      <dd className="mt-0.5">
        {editing ? (
          options ? (
            <select
              value={draft}
              onChange={event => {
                const next = event.target.value
                setDraft(next)
                void onSave(next || null)
                setEditing(false)
              }}
              onBlur={cancel}
              className={inputCls}
              autoFocus
            >
              <option value="">—</option>
              {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : multiline ? (
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={confirm}
              onKeyDown={handleKey}
              className={`${inputCls} resize-y`}
              rows={4}
              autoFocus
            />
          ) : (
            <input
              type={type}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={confirm}
              onKeyDown={handleKey}
              className={inputCls}
              autoFocus
            />
          )
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`block w-full rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors ${
              hasValue
                ? 'border-hairline bg-surface text-ink-secondary hover:border-blue-300 hover:bg-surface-muted/50 dark:hover:border-blue-700'
                : 'border-dashed border-hairline bg-surface text-ink-muted hover:border-blue-300 hover:text-ink-secondary dark:hover:border-blue-700'
            }`}
            title="Toca para editar"
          >
            {hasValue ? String(value) : 'Toca para agregar'}
          </button>
        )}
      </dd>
    </div>
  )
}

function FlagField({
  label,
  checked,
  onSave,
}: {
  label: string
  checked: boolean
  onSave: (next: boolean) => void | Promise<boolean>
}) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="mt-1">
        <Switch checked={checked} onChange={next => void onSave(next)} label={checked ? 'Sí' : 'No'} />
      </dd>
    </div>
  )
}

function InspectorDropdown({
  value,
  onSave,
}: {
  value: number | null
  onSave: (value: number | null) => Promise<boolean>
}) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [inspectorId, setInspectorId] = useState<number | null>(value)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setInspectorId(value) }, [value])

  useEffect(() => {
    supabase
      .from('staff')
      .select('id, name, role, zone, active, whatsapp, email, clients_assigned, created_at')
      .eq('role', 'inspector')
      .eq('active', 1)
      .order('name')
      .then(({ data }) => setStaff((data ?? []) as Staff[]))
  }, [])

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value ? Number(event.target.value) : null
    const previous = inspectorId
    setInspectorId(next)
    setSaving(true)
    const ok = await onSave(next)
    if (!ok) setInspectorId(previous)
    setSaving(false)
  }

  return (
    <div className="border-t border-hairline pt-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Inspector</p>
      <select
        value={inspectorId ?? ''}
        onChange={handleChange}
        disabled={saving}
        className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-ink-secondary focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:bg-surface-sunk"
      >
        <option value="">Sin asignar</option>
        {staff.map(member => (
          <option key={member.id} value={member.id}>
            {member.name}{member.zone ? ` (${member.zone})` : ''}
          </option>
        ))}
      </select>
      {saving && <p className="mt-1 text-[11px] text-ink-muted">Guardando…</p>}
    </div>
  )
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<DbNotification[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase
      .from('notifications')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setHistory((data ?? []) as DbNotification[]))
  }, [])

  function handleOpen() {
    setOpen(o => !o)
    supabase
      .from('notifications')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setHistory((data ?? []) as DbNotification[]))
  }

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const todayCount = history.filter(n => n.sent_at.slice(0, 10) === today).length

  const eventIcon = (t: DbNotification['event_type']) =>
    t === 'ready_for_inspection' ? '🟢' :
    t === 'report_received'      ? '✅' :
    t === 'reinspection_due'     ? '⚠️' : '🔴'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        aria-expanded={open}
        aria-label="Abrir notificaciones"
        className="relative rounded-lg border border-hairline bg-surface p-1.5 text-ink-tertiary transition hover:text-gray-900 dark:hover:text-slate-100"
        title="Notificaciones"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {todayCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {todayCount > 9 ? '9+' : todayCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-hairline bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <p className="text-[12px] font-semibold text-gray-700 dark:text-slate-200">Notificaciones</p>
            {todayCount > 0 && (
              <span className="text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded-full">{todayCount} hoy</span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 dark:divide-slate-700">
            {history.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-muted">Sin notificaciones</p>
            ) : history.map(n => (
              <div key={n.id} className="px-3 py-2.5 flex items-start gap-2.5 hover:bg-surface-muted/50">
                <span className="text-base leading-none mt-0.5 shrink-0">{eventIcon(n.event_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-ink-secondary leading-snug">{n.message}</p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{timeAgo(n.sent_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── briefing view ────────────────────────────────────────────────────────────

function BriefingCard({ s, onClick }: { s: Shipment; onClick: () => void }) {
  const today    = new Date().toISOString().slice(0, 10)
  const eff      = effectiveDate(s)
  const isReady  = s.ready_for_inspection === 1
  const isOverdue = eff != null && eff < today

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative block w-full overflow-hidden rounded-xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.998] ${
        isOverdue
          ? 'border-red-200 dark:border-red-800'
          : isReady
          ? 'border-emerald-200 dark:border-emerald-800'
          : 'border-hairline'
      }`}
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 ${
        isOverdue ? 'bg-red-500' : isReady ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-700'
      }`} />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-wider ${
            isOverdue ? 'text-red-600 dark:text-red-400' : isReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-tertiary'
          }`}>{s.cliente}</p>
          <p className="font-mono text-[14px] font-bold text-ink-primary mt-0.5 truncate">{s.unit_id ?? s.po ?? '—'}</p>
          {s.po && s.unit_id && <p className="font-mono text-[11px] text-ink-muted truncate">PO {s.po}</p>}
        </div>
        <StatusBadge s={s} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {s.commodity && <span className="text-[12px] text-ink-secondary">{s.commodity}</span>}
        {s.location && (
          <span className="text-[11px] bg-surface-sunk text-ink-tertiary px-1.5 py-0.5 rounded">{s.location}</span>
        )}
        {s.pallets != null && <span className="text-[11px] text-ink-muted">{s.pallets} plt</span>}
      </div>

      {(s.fda_status || s.fumigation_status || s.agriculture_usda_status) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2.5 pt-2.5 border-t border-hairline">
          {s.fda_status && (
            <span className={`text-[11px] font-medium ${
              s.fda_status.toUpperCase().includes('RELEAS') ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>FDA: {s.fda_status}</span>
          )}
          {s.fumigation_status && (
            <span className={`text-[11px] ${
              s.fumigation_status.toUpperCase().includes('CLEAR') || s.fumigation_status.toUpperCase().includes('DONE')
                ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'
            }`}>Fum: {s.fumigation_status}</span>
          )}
          {s.agriculture_usda_status && (
            <span className={`text-[11px] ${
              s.agriculture_usda_status.toUpperCase().includes('CLEAR') ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'
            }`}>Ag: {s.agriculture_usda_status}</span>
          )}
        </div>
      )}

      {s.shipper && (
        <p className="text-[11px] text-ink-muted mt-1.5 truncate">{s.shipper}</p>
      )}
    </button>
  )
}

function BriefingPanel({ shipments, onSelect }: { shipments: Shipment[]; onSelect: (s: Shipment) => void }) {
  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

  const groups = [
    {
      key: 'overdue',
      label: 'Atrasado',
      sublabel: 'ETA pasada sin inspeccionar',
      headerCls: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
      items: shipments.filter(s => { const e = effectiveDate(s); return e && e < today }),
    },
    {
      key: 'today',
      label: `Hoy — ${fmtDate(today)}`,
      sublabel: null,
      headerCls: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
      items: shipments.filter(s => effectiveDate(s) === today),
    },
    {
      key: 'tomorrow',
      label: `Mañana — ${fmtDate(tomorrow)}`,
      sublabel: null,
      headerCls: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
      items: shipments.filter(s => effectiveDate(s) === tomorrow),
    },
  ].filter(g => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <svg className="w-10 h-10 text-gray-200 dark:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[14px] text-ink-muted">Sin inspecciones para hoy ni mañana</p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {groups.map(group => (
        <div key={group.key}>
          <div className="flex items-center gap-3 mb-3">
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-semibold border ${group.headerCls}`}>
              {group.label}
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/60 dark:bg-black/20 text-[10px] font-bold">
                {group.items.length}
              </span>
            </span>
            {group.sublabel && (
              <span className="text-[12px] text-ink-muted">{group.sublabel}</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {group.items.map(s => (
              <BriefingCard key={s.id} s={s} onClick={() => onSelect(s)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

const DEFAULT_VISIBLE = new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))

type SortState = { key: string; dir: 'asc' | 'desc' } | null

export default function Dashboard({ shipments }: { shipments: Shipment[] }) {
  const router = useRouter()
  const { dark, toggle: toggleTheme } = useTheme()
  const [refreshing, setRefreshing] = useState(false)
  const handleShipmentChange = useCallback(() => {
    startTransition(() => { router.refresh() })
  }, [router])
  const { toasts, dismiss } = useRealtimeNotifications(handleShipmentChange)

  // filters
  const [search,          setSearch]    = useState('')
  const [filterCliente,   setCliente]   = useState('')
  const [filterEstado,    setEstado]    = useState('abierto')
  const [filterCommodity, setCommodity] = useState('')
  const [filterLocation,  setLocation]  = useState('')
  const [filterHoy,       setFilterHoy] = useState(false)
  const deferredSearch = useDeferredValue(search)

  // ui state
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE)
  const [colOrder,    setColOrder]    = useState<string[]>(() => COLUMNS.map(c => c.key))
  const [colFilters,  setColFilters]  = useState<Record<string, string>>({})
  const [sort,        setSort]        = useState<SortState>(null)
  const [selected,    setSelected]    = useState<Shipment | null>(null)
  const [createOpen,  setCreateOpen]  = useState(false)
  const dragColKey = useRef<string | null>(null)

  useEffect(() => {
    const p = loadProfile()
    if (!p) return
    setColOrder(mergeOrder(p.order))
    setVisibleCols(new Set(p.visible))
  }, [])

  function handleSort(key: string) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  async function handleRefresh() {
    setRefreshing(true)
    startTransition(() => { router.refresh() })
    setTimeout(() => setRefreshing(false), 1500)
  }

  function toggleCol(key: string, on: boolean) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      on ? next.add(key) : next.delete(key)
      saveProfile(colOrder, [...next])
      return next
    })
  }

  function handleColDragStart(key: string) { dragColKey.current = key }

  function handleColDrop(targetKey: string) {
    const from = dragColKey.current
    if (!from || from === targetKey) return
    setColOrder(prev => {
      const next = [...prev]
      const fi = next.indexOf(from), ti = next.indexOf(targetKey)
      if (fi === -1 || ti === -1) return prev
      next.splice(fi, 1); next.splice(ti, 0, from)
      saveProfile(next, [...visibleCols])
      return next
    })
    dragColKey.current = null
  }

  function handleResetOrder() {
    const defaultOrder = COLUMNS.map(c => c.key)
    setColOrder(defaultOrder)
    saveProfile(defaultOrder, [...visibleCols])
  }

  function handlePanelClose(dirty: boolean) {
    setSelected(null)
    if (dirty) router.refresh()
  }

  async function handleCreateShipment(form: NewShipmentForm) {
    const payload = {
      cliente: form.cliente.trim(),
      cliente_norm: normalizeClientName(form.cliente),
      tipo_carga: form.tipo_carga,
      location: toNullable(form.location),
      unit_id: toNullable(form.unit_id),
      unit_id_norm: normalizeUnitId(form.unit_id),
      po: toNullable(form.po),
      po_norm: normalizePo(form.po),
      commodity: toNullable(form.commodity),
      shipper: toNullable(form.shipper),
      country_of_origin: toNullable(form.country_of_origin),
      eta_fecha: toNullable(form.eta_fecha),
      dia_disponible_para_inspeccion: toNullable(form.dia_disponible_para_inspeccion),
      inspection_status: form.inspection_status,
      estado_general: form.estado_general,
      ready_for_inspection: form.ready_for_inspection ? 1 : 0,
      warehouse_arrival_confirmed: 0,
      report_sent: 0,
      requiere_fumigacion: 0,
      pallets: toNullableNumber(form.pallets),
      comments_raw: toNullable(form.comments_raw),
      ultima_actualizacion: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('shipments')
      .insert(payload)
      .select(SHIPMENT_SELECT)
      .single()

    if (error) {
      throw new Error(error.message)
    }

    setCreateOpen(false)
    setSelected(data as Shipment)
    startTransition(() => { router.refresh() })
  }

  const visibleColumns = useMemo(
    () => colOrder.map(k => COLUMNS.find(c => c.key === k)).filter((c): c is Col => !!c && visibleCols.has(c.key)),
    [colOrder, visibleCols],
  )

  const clientes    = useMemo(() => [...new Set(shipments.map(s => s.cliente))].sort(), [shipments])
  const commodities = useMemo(() => [...new Set(shipments.map(s => s.commodity).filter(Boolean) as string[])].sort(), [shipments])
  const locations   = useMemo(() => [...new Set(shipments.map(s => s.location).filter(Boolean) as string[])].sort(), [shipments])

  const stats = useMemo(() => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    return {
      total:    shipments.length,
      abiertos: shipments.filter(s => s.estado_general === 'abierto').length,
      listos:   shipments.filter(s => s.ready_for_inspection === 1 && s.estado_general === 'abierto').length,
      cerrados: shipments.filter(s => s.estado_general === 'cerrado').length,
      paraHoy:  shipments.filter(s => {
        if (s.estado_general !== 'abierto') return false
        const eff = effectiveDate(s)
        return eff != null && eff <= tomorrow
      }).length,
    }
  }, [shipments])

  const colOptions = useMemo(() => {
    const opts: Record<string, string[]> = {}
    for (const col of COLUMNS) {
      const rows = shipments.filter(s => {
        if (filterCliente   && s.cliente !== filterCliente) return false
        if (filterEstado    && s.estado_general !== filterEstado) return false
        if (filterCommodity && s.commodity !== filterCommodity) return false
        if (filterLocation  && s.location !== filterLocation) return false
        if (deferredSearch) {
          const q = deferredSearch.toLowerCase()
          if (![s.unit_id, s.po, s.shipper, s.cliente, s.commodity].join(' ').toLowerCase().includes(q)) return false
        }
        for (const other of COLUMNS) {
          if (other.key === col.key) continue
          const fv = colFilters[other.key]
          if (fv && other.getValue(s) !== fv) return false
        }
        return true
      })
      opts[col.key] = [...new Set(rows.map(s => col.getValue(s)).filter(Boolean))].sort()
    }
    return opts
  }, [shipments, deferredSearch, filterCliente, filterEstado, filterCommodity, filterLocation, colFilters])

  useEffect(() => {
    setColFilters(prev => {
      const next = { ...prev }; let changed = false
      for (const col of COLUMNS) {
        const fv = next[col.key]
        if (fv && !(colOptions[col.key] ?? []).includes(fv)) { delete next[col.key]; changed = true }
      }
      return changed ? next : prev
    })
  }, [colOptions])

  const baseFiltered = useMemo(() => {
    const q = deferredSearch.toLowerCase()
    return shipments.filter(s => {
      if (filterCliente   && s.cliente !== filterCliente) return false
      if (filterEstado    && s.estado_general !== filterEstado) return false
      if (filterCommodity && s.commodity !== filterCommodity) return false
      if (filterLocation  && s.location !== filterLocation) return false
      if (filterHoy) {
        if (s.estado_general !== 'abierto') return false
        const eff = effectiveDate(s)
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
        if (!eff || eff > tomorrow) return false
      }
      if (q) {
        const hay = [s.unit_id, s.po, s.shipper, s.cliente, s.commodity, s.vessel].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      for (const col of COLUMNS) {
        const fv = colFilters[col.key]
        if (fv && col.getValue(s) !== fv) return false
      }
      return true
    })
  }, [shipments, deferredSearch, filterCliente, filterEstado, filterCommodity, filterLocation, filterHoy, colFilters])

  const filtered = useMemo(() => {
    if (sort) {
      const col = COLUMNS.find(c => c.key === sort.key)
      if (!col) return baseFiltered
      return [...baseFiltered].sort((a, b) => {
        const va = col.getValue(a), vb = col.getValue(b)
        if (va === vb) return 0
        if (!va) return 1; if (!vb) return -1
        const cmp = va.localeCompare(vb, undefined, { numeric: true })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return [...baseFiltered].sort((a, b) => {
      const da = effectiveDate(a), db = effectiveDate(b)
      if (da === db) return (b.ready_for_inspection ?? 0) - (a.ready_for_inspection ?? 0)
      if (!da) return 1; if (!db) return -1
      return da.localeCompare(db)
    })
  }, [baseFiltered, sort])

  const lastUpdateIso = shipments.length
    ? shipments.reduce((a, b) => a.ultima_actualizacion > b.ultima_actualizacion ? a : b).ultima_actualizacion
    : null

  const anyFilter = search || filterCliente || (filterEstado && filterEstado !== 'abierto') || filterCommodity || filterLocation || filterHoy || Object.values(colFilters).some(Boolean)

  function clearAll() {
    setSearch(''); setCliente(''); setEstado('abierto')
    setCommodity(''); setLocation(''); setFilterHoy(false); setColFilters({})
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen bg-canvas text-ink-primary">


      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col min-h-screen min-w-0">

        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-hairline bg-surface">
          <div className="px-4 sm:px-6">
            {/* Title row */}
            <div className="flex items-center justify-between h-14 gap-4">
              {/* Mobile logo */}
              <div className="flex items-center gap-2 lg:hidden">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold">
                  IM
                </div>
                <span className="text-sm font-semibold text-ink-primary">Inspecciones</span>
              </div>
              <h1 className="hidden lg:block text-sm font-semibold text-ink-primary">
                Inspecciones
                {lastUpdateIso && (
                  <span className="ml-2 text-[11px] font-normal text-ink-muted">
                    · actualizado {timeAgo(lastUpdateIso)}
                  </span>
                )}
              </h1>

              <div className="flex items-center gap-2">
                <Link
                  href="/staff"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[13px] text-ink-secondary hover:text-gray-900 dark:hover:text-slate-100 lg:hidden"
                >
                  Equipo
                </Link>
                <Link
                  href="/clients"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[13px] text-ink-secondary hover:text-gray-900 dark:hover:text-slate-100 lg:hidden"
                >
                  Clientes
                </Link>
                <NotificationBell />
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label="Actualizar"
                  className="rounded-lg border border-hairline bg-surface p-1.5 text-ink-tertiary hover:text-gray-900 dark:hover:text-slate-100 disabled:opacity-40 transition-colors"
                >
                  <svg className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <ThemeToggle dark={dark} toggle={toggleTheme} />
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3 pb-3">
              <StatCard label="Total"      value={stats.total}    hint="base completa"      tone="slate" />
              <StatCard label="Abiertos"   value={stats.abiertos} hint="en curso"            tone="blue" />
              <StatCard label="Listos"     value={stats.listos}   hint="para inspección"     tone="emerald" />
              <StatCard label="48h"        value={stats.paraHoy}  hint="requieren atención"  tone="amber" />
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 px-4 sm:px-6 py-4 space-y-3">

          {/* Filter bar */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Chip label="Buscar container, PO..." value={search} onChange={setSearch} isSearch />
              <Chip label="Cliente"   value={filterCliente}   onChange={setCliente}   options={clientes} />
              <Chip label="Commodity" value={filterCommodity} onChange={setCommodity} options={commodities} />
              <Chip label="Location"  value={filterLocation}  onChange={setLocation}  options={locations} />
              <Chip
                label="Estado"
                value={filterEstado === 'abierto' ? '' : filterEstado}
                onChange={v => setEstado(v || 'abierto')}
                options={['abierto', 'cerrado']}
              />
              {anyFilter && (
                <button
                  onClick={clearAll}
                  className="text-[12px] text-ink-muted hover:text-gray-700 dark:hover:text-slate-300 underline underline-offset-2"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button size="sm" icon="plus" onClick={() => setCreateOpen(true)}>
                Nueva inspección
              </Button>

              <button
                onClick={() => { setFilterHoy(h => !h); setEstado('abierto') }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
                  filterHoy
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    : 'border-hairline bg-surface text-ink-secondary hover:border-gray-300 dark:hover:border-slate-600'
                }`}
              >
                {filterHoy ? '★' : '☆'} Agenda 48h
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-sunk px-1.5 text-[11px] font-bold text-gray-600 dark:text-slate-400">
                  {stats.paraHoy}
                </span>
              </button>

              <span className="text-[12px] text-ink-muted whitespace-nowrap">
                {filtered.length} / {shipments.length}
              </span>

              <ColPicker visible={visibleCols} onChange={toggleCol} onResetOrder={handleResetOrder} />
            </div>
          </div>

          {/* Content area */}
          {filterHoy ? (
            <div className="rounded-xl border border-hairline bg-surface overflow-hidden">
              <div className="px-5 py-3 border-b border-hairline">
                <h2 className="text-sm font-semibold text-ink-primary">Agenda — hoy y mañana</h2>
              </div>
              <div className="p-5">
                <BriefingPanel shipments={filtered} onSelect={setSelected} />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-hairline bg-surface overflow-hidden">
              {/* Table legend */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
                <h2 className="text-sm font-semibold text-ink-primary">Tabla operativa</h2>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Urgente
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Hoy
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Listo
                  </span>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead>
                    <tr>
                      {visibleColumns.map(col => {
                        const isActive = sort?.key === col.key
                        return (
                          <th
                            key={col.key}
                            draggable
                            onDragStart={() => handleColDragStart(col.key)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => handleColDrop(col.key)}
                            onClick={() => handleSort(col.key)}
                            className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-hairline bg-surface-sunk px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-tertiary transition-colors hover:bg-gray-100 dark:hover:bg-surface-muted ${
                              isActive ? 'text-ink-primary' : ''
                            } ${col.tdClass ?? ''}`}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <span className="cursor-grab text-[10px] opacity-20 hover:opacity-60">⠿</span>
                              {col.label}
                              <span className="text-[10px] opacity-40">
                                {isActive ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            </span>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {filtered.map(s => {
                      const today = new Date().toISOString().slice(0, 10)
                      const isCerrado = s.estado_general === 'cerrado'
                      const isListo = s.ready_for_inspection === 1 && !isCerrado
                      const eff = effectiveDate(s)
                      const isOverdue = isListo && eff != null && eff < today
                      const isHoy = isListo && eff === today

                      return (
                        <tr
                          key={s.id}
                          onClick={() => setSelected(s)}
                          className={[
                            'group cursor-pointer transition-colors',
                            isCerrado ? 'opacity-50 hover:bg-surface-muted' : '',
                            isOverdue ? 'bg-red-50/50 dark:bg-red-950/20 hover:bg-red-100/50 dark:hover:bg-red-950/30' : '',
                            isHoy ? 'bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-950/30' : '',
                            isListo && !isOverdue && !isHoy ? 'hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20' : '',
                            !isListo && !isCerrado ? 'hover:bg-surface-muted' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {visibleColumns.map(col => (
                            <td
                              key={col.key}
                              className={`border-b border-hairline/60 px-3 py-3 whitespace-nowrap ${col.tdClass ?? ''}`}
                            >
                              {col.render(s)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}

                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={visibleColumns.length} className="px-6 py-16 text-center">
                          <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                            <svg className="h-8 w-8 text-gray-200 dark:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 15.75L18 18m-3.75-2.25A6.75 6.75 0 1118 9a6.75 6.75 0 01-3.75 6.75z" />
                            </svg>
                            <p className="text-sm text-ink-tertiary">Sin resultados con los filtros actuales.</p>
                            <button onClick={clearAll} className="text-[13px] text-blue-600 dark:text-blue-400 hover:underline">
                              Limpiar filtros
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Detail panel */}
      {selected && <DetailPanel s={selected} onClose={handlePanelClose} />}

      <CreateShipmentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateShipment}
      />

      {/* Toast notifications */}
      <ToastList toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
