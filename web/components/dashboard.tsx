'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Shipment, DbNotification, Staff } from '@/lib/types'
import { supabase } from '@/lib/supabase'

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
          className={`pointer-events-auto bg-white rounded-lg shadow-lg border border-slate-200 border-l-4 ${EVENT_COLORS[t.event_type]} px-4 py-3 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-800">{EVENT_LABELS[t.event_type]}</p>
            <p className="text-[12px] text-slate-500 mt-0.5 truncate">{t.message}</p>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none shrink-0 mt-0.5"
          >✕</button>
        </div>
      ))}
    </div>
  )
}

function useRealtimeNotifications() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('notifications-push')
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
          setToasts(prev => [toast, ...prev].slice(0, 5))  // max 5 toasts
          // Auto-dismiss after 8 seconds
          setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toast.id)), 8000)
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

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
  if (!grade) return 'text-slate-400'
  if (grade.startsWith('A')) return 'text-emerald-600 font-semibold'
  if (grade.startsWith('B')) return 'text-amber-500 font-semibold'
  if (grade.startsWith('C')) return 'text-orange-500 font-semibold'
  if (grade.startsWith('D')) return 'text-red-600 font-semibold'
  return 'text-slate-600'
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
    render: s => <span className="font-mono text-[13px] font-medium text-slate-900">{s.po ?? '—'}</span>,
  },
  {
    key: 'unit_id', label: 'Container', defaultVisible: true,
    getValue: s => s.unit_id ?? '',
    render: s => <span className="font-mono text-[13px] text-slate-700">{s.unit_id ?? '—'}</span>,
  },
  {
    key: 'commodity', label: 'Commodity', defaultVisible: true,
    getValue: s => s.commodity ?? '',
    render: s => <span className="text-[13px] text-slate-700">{s.commodity ?? '—'}</span>,
  },
  {
    key: 'location', label: 'Location', defaultVisible: true,
    getValue: s => s.location ?? '',
    render: s => s.location
      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">{s.location}</span>
      : <span className="text-slate-300">—</span>,
  },
  {
    key: 'shipper', label: 'Warehouse', defaultVisible: true,
    getValue: s => s.shipper ?? '',
    render: s => <span className="text-[13px] text-slate-600 max-w-[160px] truncate block">{s.shipper ?? '—'}</span>,
    tdClass: 'max-w-[160px]',
  },
  {
    key: 'country_of_origin', label: 'Origin', defaultVisible: true,
    getValue: s => s.country_of_origin ?? '',
    render: s => <span className="text-[13px] text-slate-600">{s.country_of_origin ?? '—'}</span>,
  },
  {
    key: 'cliente', label: 'Client', defaultVisible: true,
    getValue: s => s.cliente ?? '',
    render: s => <span className="text-[13px] text-slate-800">{s.cliente}</span>,
  },
  {
    key: 'vessel', label: 'Carrier', defaultVisible: false,
    getValue: s => s.vessel ?? '',
    render: s => <span className="text-[13px] text-slate-500 uppercase tracking-wide">{s.vessel ? 'OCEAN' : '—'}</span>,
  },
  {
    key: 'bl', label: 'BL#', defaultVisible: false,
    getValue: s => s.bl ?? '',
    render: s => <span className="font-mono text-[12px] text-slate-500">{s.bl ?? '—'}</span>,
  },
  {
    key: 'dia_disponible', label: 'Inspection Date', defaultVisible: true,
    getValue: s => effectiveDate(s) ?? '',
    render: s => <InspDateCell s={s} />,
  },
  {
    key: 'pallets', label: 'Pallets', defaultVisible: true,
    getValue: s => s.pallets != null ? String(s.pallets) : '',
    render: s => <span className="text-[13px] text-slate-600">{s.pallets ?? '—'}</span>,
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
      ? <span className="inline-flex items-center gap-1 text-[13px] text-slate-600"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0" />Asignado</span>
      : <span className="text-slate-300 text-[13px]">—</span>,
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
  if (!eff) return <span className="text-slate-300 text-[13px]">—</span>
  const today = new Date().toISOString().slice(0, 10)
  const label = fmtDate(eff)
  if (eff < today)  return <span className="text-[13px] text-red-500 font-medium">{label}</span>
  if (eff === today) return <span className="text-[13px] text-amber-600 font-semibold">{label} ●</span>
  return <span className="text-[13px] text-slate-700">{label}</span>
}

function ReinspCell({ date, estado }: { date: string | null; estado: string }) {
  if (!date || estado === 'cerrado') return <span className="text-slate-300 text-[13px]">—</span>
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const label = fmtDate(date)
  if (date < today)  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">⚠ {label}</span>
  if (date === today) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-600">HOY</span>
  if (date === tomorrow) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700">Mañana</span>
  return <span className="text-[13px] text-slate-500">{label}</span>
}

function StatusBadge({ s }: { s: Shipment }) {
  if (s.estado_general === 'cerrado') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 uppercase tracking-wide">Done</span>
  }
  if (s.ready_for_inspection === 1) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 uppercase tracking-wide">Ready</span>
  }
  if (s.inspection_status === 'programada') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 uppercase tracking-wide">Scheduled</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 uppercase tracking-wide">Pending</span>
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
        <svg className="absolute left-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>
        <input
          type="text"
          placeholder={label}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="pl-8 pr-3 py-1.5 text-[13px] border border-slate-200 rounded-full bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-44"
        />
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-full border transition-colors ${
          isActive
            ? 'bg-slate-900 text-white border-slate-900'
            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-800'
        }`}
      >
        {isActive ? `${label}: ${value}` : label}
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && options && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px]">
          <button
            onClick={() => { onChange(''); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50"
          >
            Todos
          </button>
          {options.map(o => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-slate-50 ${
                value === o ? 'text-slate-900 font-medium' : 'text-slate-600'
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-full border border-slate-200 bg-white text-slate-600 hover:border-slate-400"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Columnas
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg p-3 w-52">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Mostrar columnas</p>
          <div className="space-y-0.5 max-h-72 overflow-y-auto">
            {COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 py-1 px-1 cursor-pointer hover:bg-slate-50 rounded text-[13px] text-slate-700">
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  onChange={e => onChange(col.key, e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                {col.label}
              </label>
            ))}
          </div>
          <div className="border-t border-slate-100 mt-2 pt-2 flex gap-2">
            <button onClick={() => COLUMNS.forEach(c => onChange(c.key, true))} className="text-[12px] text-blue-600 hover:underline">Todas</button>
            <span className="text-slate-300">·</span>
            <button onClick={() => COLUMNS.forEach(c => onChange(c.key, c.defaultVisible))} className="text-[12px] text-slate-400 hover:underline">Reset cols</button>
            {onResetOrder && (
              <>
                <span className="text-slate-300">·</span>
                <button onClick={onResetOrder} className="text-[12px] text-slate-400 hover:underline">Reset orden</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── sidebar ──────────────────────────────────────────────────────────────────

function SidebarIcon({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <div className={`w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
      active ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'
    }`}>
      {children}
    </div>
  )
}

// ─── detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ s, onClose }: { s: Shipment; onClose: (dirty: boolean) => void }) {
  const [local,  setLocal]  = useState<Shipment>(s)
  const [dirty,  setDirty]  = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  // If parent refreshes (s changes identity), re-sync only when panel is clean
  useEffect(() => { if (!dirty) setLocal(s) }, [s, dirty])

  const today = new Date().toISOString().slice(0, 10)
  const eff   = effectiveDate(local)

  async function save(field: keyof Shipment, value: unknown) {
    setSaving(field as string)
    const patch = { [field]: value } as Partial<Shipment>
    setLocal(prev => ({ ...prev, ...patch }))
    setDirty(true)
    await supabase.from('shipments').update(patch).eq('id', local.id)
    setSaving(null)
  }

  function sv(field: keyof Shipment) {
    return (v: string | null) => save(field, v)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={() => onClose(dirty)}>
      <div
        className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="bg-slate-900 px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">{local.cliente}</p>
            <h2 className="text-base font-bold text-white mt-0.5 font-mono">{local.unit_id ?? local.po ?? '—'}</h2>
            {local.po && local.unit_id && <p className="text-[12px] text-slate-400 mt-0.5 font-mono">PO: {local.po}</p>}
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[11px] text-slate-400 animate-pulse">Guardando…</span>}
            {dirty && !saving && <span className="text-[11px] text-emerald-400">✓ Guardado</span>}
            <button onClick={() => onClose(dirty)} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
          </div>
        </div>

        {/* status strip */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
          <StatusBadge s={local} />
          {eff && (
            <span className={`text-[13px] ${eff < today ? 'text-red-500 font-medium' : eff === today ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
              {eff === today ? 'Hoy — ' : ''}{fmtDate(eff)}
            </span>
          )}
          {local.location && (
            <span className="ml-auto text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{local.location}</span>
          )}
        </div>

        {/* body */}
        <div className="flex-1 px-5 py-4 space-y-5">

          {/* status overrides */}
          <section>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Estado</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <EField label="Estado general" value={local.estado_general} onSave={sv('estado_general')}
                options={[{value:'abierto',label:'Abierto'},{value:'cerrado',label:'Cerrado'}]} />
              <EField label="Inspección" value={local.inspection_status} onSave={sv('inspection_status')}
                options={[{value:'pendiente',label:'Pendiente'},{value:'programada',label:'Programada'},{value:'completada',label:'Completada'}]} />
            </dl>
          </section>

          {/* shipment info */}
          <section className="border-t border-slate-100 pt-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Envío</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <EField label="Commodity"   value={local.commodity}       onSave={sv('commodity')} />
              <EField label="País origen" value={local.country_of_origin} onSave={sv('country_of_origin')} />
              <EField label="Shipper"     value={local.shipper}          onSave={sv('shipper')} />
              <EField label="ETA"         value={local.eta_fecha}        onSave={sv('eta_fecha')} type="date" />
              <EField label="Día disp."   value={local.dia_disponible_para_inspeccion} onSave={sv('dia_disponible_para_inspeccion')} type="date" />
              <EField label="BL#"         value={local.bl}               onSave={sv('bl')} />
              <EField label="Buque"       value={local.vessel}           onSave={sv('vessel')} />
              <EField label="Pallets"     value={local.pallets != null ? String(local.pallets) : null} onSave={v => save('pallets', v ? parseInt(v) : null)} type="number" />
              <EField label="PO"          value={local.po}               onSave={sv('po')} />
              <EField label="Container"   value={local.unit_id}          onSave={sv('unit_id')} />
              {local.reinspection_due_date && (
                <DetailKV label="Reinsp. due" value={fmtDate(local.reinspection_due_date)} />
              )}
            </dl>
          </section>

          {/* customs statuses */}
          <section className="border-t border-slate-100 pt-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Estatus aduanas</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <EField label="FDA"        value={local.fda_status}               onSave={sv('fda_status')} />
              <EField label="Customs"    value={local.customs_status}            onSave={sv('customs_status')} />
              <EField label="USDA"       value={local.agriculture_usda_status}   onSave={sv('agriculture_usda_status')} />
              <EField label="Fumigación" value={local.fumigation_status}         onSave={sv('fumigation_status')} />
            </dl>
          </section>

          {/* inspection results */}
          {(local.overall_grade || local.condition_text || local.quality_text) && (
            <section className="border-t border-slate-100 pt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Resultado</p>
              {local.overall_grade && (
                <p className={`text-2xl font-bold mb-2 ${gradeColor(local.overall_grade)}`}>Grade {local.overall_grade}</p>
              )}
              {local.condition_text && (
                <div className="mb-2">
                  <p className="text-[11px] text-slate-400 mb-0.5">Condición</p>
                  <p className="text-[13px] text-slate-700 leading-relaxed">{local.condition_text}</p>
                </div>
              )}
              {local.quality_text && (
                <div className="mb-2">
                  <p className="text-[11px] text-slate-400 mb-0.5">Calidad</p>
                  <p className="text-[13px] text-slate-700 leading-relaxed">{local.quality_text}</p>
                </div>
              )}
              {local.report_url && (
                <a href={local.report_url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:underline mt-1">
                  Ver reporte completo
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </section>
          )}

          {/* lots */}
          {local.lots_raw && (
            <section className="border-t border-slate-100 pt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Lots</p>
              <pre className="text-[12px] text-slate-700 bg-slate-50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">{local.lots_raw}</pre>
            </section>
          )}

          {/* inspector assignment */}
          <InspectorDropdown shipment={local} />

          {/* comments */}
          <section className="border-t border-slate-100 pt-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Comentarios</p>
            <EField label="" value={local.comments_raw} onSave={sv('comments_raw')} multiline />
          </section>

        </div>
      </div>
    </div>
  )
}

function DetailKV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="text-[13px] text-slate-800 mt-0.5">{value || '—'}</dd>
    </div>
  )
}

// ─── editable field ───────────────────────────────────────────────────────────

type EFieldOption = { value: string; label: string }

function EField({
  label, value, onSave, type = 'text', options, multiline,
}: {
  label: string
  value: string | number | null | undefined
  onSave: (v: string | null) => void
  type?: 'text' | 'date' | 'number'
  options?: EFieldOption[]
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(String(value ?? ''))

  useEffect(() => { if (!editing) setDraft(String(value ?? '')) }, [value, editing])

  function confirm() { setEditing(false); onSave(draft.trim() || null) }
  function cancel()  { setDraft(String(value ?? '')); setEditing(false) }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !multiline) confirm()
    if (e.key === 'Escape') cancel()
  }

  const inputCls = 'w-full text-[13px] border border-blue-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="group">
      <dt className="text-[11px] text-slate-400 flex items-center gap-1">
        {label}
        {!editing && (
          <button
            onClick={e => { e.stopPropagation(); setEditing(true) }}
            className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
            title="Editar"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </dt>
      <dd className="mt-0.5">
        {editing ? (
          options ? (
            <select
              value={draft}
              onChange={e => { const v = e.target.value; setDraft(v); onSave(v || null); setEditing(false) }}
              onBlur={cancel}
              className={inputCls}
              autoFocus
            >
              <option value="">—</option>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : multiline ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={confirm}
              onKeyDown={handleKey}
              className={`${inputCls} resize-none`}
              rows={3}
              autoFocus
            />
          ) : (
            <input
              type={type}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={confirm}
              onKeyDown={handleKey}
              className={inputCls}
              autoFocus
            />
          )
        ) : (
          <span
            className="text-[13px] text-slate-800 block py-0.5 cursor-text hover:bg-blue-50 rounded -mx-0.5 px-0.5 transition-colors"
            onDoubleClick={() => setEditing(true)}
            title="Doble clic para editar"
          >
            {value != null && value !== '' ? String(value) : <span className="text-slate-300">—</span>}
          </span>
        )}
      </dd>
    </div>
  )
}

function InspectorDropdown({ shipment }: { shipment: Shipment }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [inspectorId, setInspectorId] = useState<number | null>(shipment.inspector_id)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('staff')
      .select('id, name, role, zone, active, whatsapp, email, clients_assigned, created_at')
      .eq('role', 'inspector')
      .eq('active', 1)
      .order('name')
      .then(({ data }) => setStaff((data ?? []) as Staff[]))
  }, [])

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value ? Number(e.target.value) : null
    setSaving(true)
    await supabase.from('shipments').update({ inspector_id: val }).eq('id', shipment.id)
    setInspectorId(val)
    setSaving(false)
  }

  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Inspector</p>
      <select
        value={inspectorId ?? ''}
        onChange={handleChange}
        disabled={saving}
        className="w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        <option value="">Sin asignar</option>
        {staff.map(m => (
          <option key={m.id} value={m.id}>
            {m.name}{m.zone ? ` (${m.zone})` : ''}
          </option>
        ))}
      </select>
      {saving && <p className="text-[11px] text-slate-400 mt-1">Guardando…</p>}
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

  // Refresh list when panel opens
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
        className="relative p-1 rounded text-slate-500 hover:text-white transition-colors"
        title="Notificaciones"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg w-80">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-slate-700">Notificaciones</p>
            {todayCount > 0 && (
              <span className="text-[10px] font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{todayCount} hoy</span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
            {history.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-slate-400">Sin notificaciones</p>
            ) : history.map(n => (
              <div key={n.id} className="px-3 py-2.5 flex items-start gap-2.5 hover:bg-slate-50">
                <span className="text-base leading-none mt-0.5 shrink-0">{eventIcon(n.event_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-slate-700 leading-snug">{n.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.sent_at)}</p>
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

  const clientColor = isOverdue ? 'text-red-600' : isReady ? 'text-emerald-600' : 'text-slate-500'

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-px active:scale-[0.99] ${
        isOverdue ? 'border-red-200 bg-red-50/40' : isReady ? 'border-emerald-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-wider ${clientColor}`}>{s.cliente}</p>
          <p className="font-mono text-[14px] font-bold text-slate-900 mt-0.5 truncate">{s.unit_id ?? s.po ?? '—'}</p>
          {s.po && s.unit_id && <p className="font-mono text-[11px] text-slate-400 truncate">PO {s.po}</p>}
        </div>
        <StatusBadge s={s} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {s.commodity && <span className="text-[12px] text-slate-700">{s.commodity}</span>}
        {s.location && (
          <span className="text-[11px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{s.location}</span>
        )}
        {s.pallets != null && <span className="text-[11px] text-slate-400">{s.pallets} plt</span>}
      </div>

      {(s.fda_status || s.fumigation_status || s.agriculture_usda_status) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2.5 pt-2.5 border-t border-slate-100">
          {s.fda_status && (
            <span className={`text-[11px] font-medium ${
              s.fda_status.toUpperCase().includes('RELEAS') ? 'text-emerald-600' : 'text-amber-600'
            }`}>
              FDA: {s.fda_status}
            </span>
          )}
          {s.fumigation_status && (
            <span className={`text-[11px] ${
              s.fumigation_status.toUpperCase().includes('CLEAR') || s.fumigation_status.toUpperCase().includes('DONE')
                ? 'text-emerald-600' : 'text-amber-500'
            }`}>
              Fum: {s.fumigation_status}
            </span>
          )}
          {s.agriculture_usda_status && (
            <span className={`text-[11px] ${
              s.agriculture_usda_status.toUpperCase().includes('CLEAR') ? 'text-emerald-600' : 'text-amber-500'
            }`}>
              Ag: {s.agriculture_usda_status}
            </span>
          )}
        </div>
      )}

      {s.shipper && (
        <p className="text-[11px] text-slate-400 mt-1.5 truncate">{s.shipper}</p>
      )}
    </div>
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
      headerCls: 'text-red-700 bg-red-50 border-red-200',
      items: shipments.filter(s => { const e = effectiveDate(s); return e && e < today }),
    },
    {
      key: 'today',
      label: `Hoy — ${fmtDate(today)}`,
      sublabel: null,
      headerCls: 'text-amber-700 bg-amber-50 border-amber-200',
      items: shipments.filter(s => effectiveDate(s) === today),
    },
    {
      key: 'tomorrow',
      label: `Mañana — ${fmtDate(tomorrow)}`,
      sublabel: null,
      headerCls: 'text-blue-700 bg-blue-50 border-blue-200',
      items: shipments.filter(s => effectiveDate(s) === tomorrow),
    },
  ].filter(g => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 pb-20">
        <svg className="w-12 h-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[14px] font-medium text-slate-400">Sin inspecciones para hoy ni mañana</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 min-h-0">
      <div className="space-y-8">
        {groups.map(group => (
          <div key={group.key}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-semibold border ${group.headerCls}`}>
                {group.label}
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/60 text-[10px] font-bold">
                  {group.items.length}
                </span>
              </span>
              {group.sublabel && (
                <span className="text-[12px] text-slate-400">{group.sublabel}</span>
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
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

const DEFAULT_VISIBLE = new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))

type SortState = { key: string; dir: 'asc' | 'desc' } | null

export default function Dashboard({ shipments }: { shipments: Shipment[] }) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const { toasts, dismiss } = useRealtimeNotifications()

  // filters
  const [search,         setSearch]         = useState('')
  const [filterCliente,  setCliente]        = useState('')
  const [filterEstado,   setEstado]         = useState('abierto')
  const [filterCommodity,setCommodity]      = useState('')
  const [filterLocation, setLocation]       = useState('')
  const [filterHoy,      setFilterHoy]      = useState(false)

  // ui state
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE)
  const [colOrder,    setColOrder]    = useState<string[]>(() => COLUMNS.map(c => c.key))
  const [colFilters,  setColFilters]  = useState<Record<string, string>>({})
  const [sort,        setSort]        = useState<SortState>(null)
  const [selected,    setSelected]    = useState<Shipment | null>(null)
  const dragColKey = useRef<string | null>(null)

  // load profile from localStorage on mount
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
    router.refresh()
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

  function handleColDragStart(key: string) {
    dragColKey.current = key
  }

  function handleColDrop(targetKey: string) {
    const from = dragColKey.current
    if (!from || from === targetKey) return
    setColOrder(prev => {
      const next = [...prev]
      const fi = next.indexOf(from)
      const ti = next.indexOf(targetKey)
      if (fi === -1 || ti === -1) return prev
      next.splice(fi, 1)
      next.splice(ti, 0, from)
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

  const visibleColumns = useMemo(
    () => colOrder.map(k => COLUMNS.find(c => c.key === k)).filter((c): c is Col => !!c && visibleCols.has(c.key)),
    [colOrder, visibleCols],
  )

  // unique lists for filter chips
  const clientes = useMemo(() => [...new Set(shipments.map(s => s.cliente))].sort(), [shipments])
  const commodities = useMemo(() => [...new Set(shipments.map(s => s.commodity).filter(Boolean) as string[])].sort(), [shipments])
  const locations = useMemo(() => [...new Set(shipments.map(s => s.location).filter(Boolean) as string[])].sort(), [shipments])

  // stats
  const stats = useMemo(() => {
    const today    = new Date().toISOString().slice(0, 10)
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

  // cascading column options
  const colOptions = useMemo(() => {
    const opts: Record<string, string[]> = {}
    for (const col of COLUMNS) {
      const rows = shipments.filter(s => {
        if (filterCliente  && s.cliente !== filterCliente) return false
        if (filterEstado   && s.estado_general !== filterEstado) return false
        if (filterCommodity && s.commodity !== filterCommodity) return false
        if (filterLocation && s.location !== filterLocation) return false
        if (search) {
          const q = search.toLowerCase()
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
  }, [shipments, search, filterCliente, filterEstado, filterCommodity, filterLocation, colFilters])

  // clear cascaded-out col filters
  useEffect(() => {
    setColFilters(prev => {
      const next = { ...prev }
      let changed = false
      for (const col of COLUMNS) {
        const fv = next[col.key]
        if (fv && !(colOptions[col.key] ?? []).includes(fv)) {
          delete next[col.key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [colOptions])

  // filtered rows
  const baseFiltered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const q = search.toLowerCase()
    return shipments.filter(s => {
      if (filterCliente  && s.cliente !== filterCliente) return false
      if (filterEstado   && s.estado_general !== filterEstado) return false
      if (filterCommodity && s.commodity !== filterCommodity) return false
      if (filterLocation && s.location !== filterLocation) return false
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
  }, [shipments, search, filterCliente, filterEstado, filterCommodity, filterLocation, filterHoy, colFilters])

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
    // default: sort by effective inspection date asc, ready first within same date
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
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans">

      {/* ── Sidebar ── */}
      <nav className="w-14 bg-slate-900 flex flex-col items-center py-3 gap-1 shrink-0">
        <div className="mb-3">
          <SidebarIcon>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          </SidebarIcon>
        </div>

        <SidebarIcon active>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
        </SidebarIcon>

        <SidebarIcon>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </SidebarIcon>

        <a href="/staff">
          <SidebarIcon>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </SidebarIcon>
        </a>

        <SidebarIcon>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        </SidebarIcon>

        <SidebarIcon>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
        </SidebarIcon>

        <div className="flex-1" />

        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-[11px] font-bold mb-1">
          MM
        </div>
      </nav>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* ── Top bar ── */}
        <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-4 gap-4 shrink-0">
          <div className="flex items-center gap-2 text-slate-400 text-[13px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <span className="text-slate-500">Buscar...</span>
          </div>
          <div className="flex-1" />
          {/* stats pills */}
          <div className="flex items-center gap-4 text-[12px]">
            <span className="text-slate-400">{stats.total} envíos</span>
            <span className="text-blue-400">{stats.abiertos} abiertos</span>
            <span className="text-emerald-400">{stats.listos} listos</span>
            {lastUpdateIso && (
              <span className="text-slate-500">Actualizado {timeAgo(lastUpdateIso)}</span>
            )}
          </div>
          <NotificationBell />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 rounded text-slate-500 hover:text-white transition-colors disabled:opacity-40"
          >
            <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* ── Page header ── */}
        <div className="px-6 pt-5 pb-2 flex items-start justify-between shrink-0">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Inspecciones</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Gestión de envíos y calidad · Elite Quality Assurance</p>
          </div>
          <button
            onClick={() => { setFilterHoy(h => !h); setEstado('abierto') }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              filterHoy
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-slate-900 text-white hover:bg-slate-700'
            }`}
          >
            <span className="text-base leading-none">{filterHoy ? '★' : '☆'}</span>
            Hoy &amp; Mañana
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${
              filterHoy ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-300'
            }`}>{stats.paraHoy}</span>
          </button>
        </div>

        {/* ── Filter chips ── */}
        <div className="px-6 pb-3 flex flex-wrap gap-2 items-center shrink-0">
          <Chip label="Buscar container, PO..." value={search} onChange={setSearch} isSearch />
          <Chip label="Cliente"     value={filterCliente}   onChange={setCliente}   options={clientes} />
          <Chip label="Commodity"   value={filterCommodity} onChange={setCommodity} options={commodities} />
          <Chip label="Location"    value={filterLocation}  onChange={setLocation}  options={locations} />
          <Chip
            label="Estado"
            value={filterEstado === 'abierto' ? '' : filterEstado}
            onChange={v => setEstado(v || 'abierto')}
            options={['abierto', 'cerrado']}
          />

          {anyFilter && (
            <button onClick={clearAll} className="text-[12px] text-slate-400 hover:text-slate-700 underline underline-offset-2">
              Limpiar
            </button>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-slate-400">{filtered.length} de {shipments.length}</span>
            <ColPicker visible={visibleCols} onChange={toggleCol} onResetOrder={handleResetOrder} />
          </div>
        </div>

        {/* ── Content: Briefing or Table ── */}
        {filterHoy ? (
          <BriefingPanel shipments={filtered} onSelect={setSelected} />
        ) : (
        <div className="flex-1 overflow-auto px-6 pb-6 min-h-0">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-800">
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
                        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none transition-colors hover:bg-slate-700 ${
                          isActive ? 'text-blue-300' : 'text-slate-300'
                        } ${col.tdClass ?? ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <span className="opacity-30 text-[10px] mr-0.5 cursor-grab">⠿</span>
                          {col.label}
                          <span className="opacity-50 text-[10px]">
                            {isActive ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => {
                  const today     = new Date().toISOString().slice(0, 10)
                  const isCerrado = s.estado_general === 'cerrado'
                  const isListo   = s.ready_for_inspection === 1 && !isCerrado
                  const eff       = effectiveDate(s)
                  const isOverdue = isListo && eff != null && eff < today
                  const isHoy     = isListo && eff === today

                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={[
                        'cursor-pointer transition-colors',
                        isCerrado  ? 'opacity-50 hover:opacity-70 hover:bg-slate-50' : '',
                        isOverdue  ? 'bg-red-50 hover:bg-red-100' : '',
                        isHoy      ? 'bg-amber-50 hover:bg-amber-100' : '',
                        isListo && !isOverdue && !isHoy ? 'hover:bg-emerald-50' : '',
                        !isListo && !isCerrado ? 'hover:bg-slate-50' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {visibleColumns.map(col => (
                        <td key={col.key} className={`px-3 py-2.5 whitespace-nowrap ${col.tdClass ?? ''}`}>
                          {col.render(s)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-20 text-center text-[13px] text-slate-400">
                      No se encontraron envíos con los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      {selected && <DetailPanel s={selected} onClose={handlePanelClose} />}

      {/* ── Toast notifications (Supabase Realtime) ── */}
      <ToastList toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
