'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Shipment } from '@/lib/types'

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'hace un momento'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  return `hace ${Math.floor(hrs / 24)}d`
}

// ─── column definitions ──────────────────────────────────────────────────────

type Col = {
  key: string
  label: string
  defaultVisible: boolean
  // raw string used for column-level filtering (null = not filterable)
  getValue: (s: Shipment) => string
  // what renders inside the cell
  render: (s: Shipment) => React.ReactNode
  thClass?: string
  tdClass?: string
}

const COLUMNS: Col[] = [
  {
    key: 'cliente', label: 'Cliente', defaultVisible: true,
    getValue: s => s.cliente ?? '',
    render:   s => <span className="font-medium text-gray-900 whitespace-nowrap">{s.cliente}</span>,
  },
  {
    key: 'unit_id', label: 'Container / AWB', defaultVisible: true,
    getValue: s => s.unit_id ?? '',
    render:   s => <span className="font-mono text-gray-700">{s.unit_id ?? '—'}</span>,
  },
  {
    key: 'po', label: 'PO', defaultVisible: true,
    getValue: s => s.po ?? '',
    render:   s => <span className="font-mono text-gray-500">{s.po ?? '—'}</span>,
  },
  {
    key: 'commodity', label: 'Commodity', defaultVisible: true,
    getValue: s => s.commodity ?? '',
    render:   s => <>{s.commodity ?? '—'}</>,
  },
  {
    key: 'country_of_origin', label: 'País', defaultVisible: true,
    getValue: s => s.country_of_origin ?? '',
    render:   s => <>{s.country_of_origin ?? '—'}</>,
  },
  {
    key: 'eta_fecha', label: 'ETA', defaultVisible: true,
    getValue: s => s.eta_fecha ?? '',
    render:   s => <EtaCell eta={s.eta_fecha} />,
  },
  {
    key: 'shipper', label: 'Shipper', defaultVisible: true,
    getValue: s => s.shipper ?? '',
    render:   s => <span className="max-w-[130px] truncate block text-gray-600">{s.shipper ?? '—'}</span>,
    tdClass: 'max-w-[130px]',
  },
  {
    key: 'vessel', label: 'Buque', defaultVisible: false,
    getValue: s => s.vessel ?? '',
    render:   s => <span className="max-w-[130px] truncate block text-gray-600">{s.vessel ?? '—'}</span>,
    tdClass: 'max-w-[130px]',
  },
  {
    key: 'bl', label: 'BL#', defaultVisible: false,
    getValue: s => s.bl ?? '',
    render:   s => <span className="font-mono text-gray-600">{s.bl ?? '—'}</span>,
  },
  {
    key: 'fda_status', label: 'FDA', defaultVisible: true,
    getValue: s => s.fda_status ?? '',
    render:   s => <StatusCell value={s.fda_status} />,
  },
  {
    key: 'agriculture_usda_status', label: 'USDA', defaultVisible: true,
    getValue: s => s.agriculture_usda_status ?? '',
    render:   s => <span className="max-w-[180px] truncate block"><StatusCell value={s.agriculture_usda_status} /></span>,
    tdClass: 'max-w-[180px]',
  },
  {
    key: 'customs_status', label: 'Customs', defaultVisible: true,
    getValue: s => s.customs_status ?? '',
    render:   s => <StatusCell value={s.customs_status} />,
  },
  {
    key: 'fumigation_status', label: 'Fumigación', defaultVisible: false,
    getValue: s => s.fumigation_status ?? '',
    render:   s => <StatusCell value={s.fumigation_status} />,
  },
  {
    key: 'warehouse_arrival_confirmed', label: 'Bodega', defaultVisible: true,
    getValue: s => s.warehouse_arrival_confirmed ? 'sí' : 'no',
    render:   s => s.warehouse_arrival_confirmed
      ? <span className="text-green-600 font-bold">✓</span>
      : <span className="text-gray-300">—</span>,
    thClass: 'text-center', tdClass: 'text-center',
  },
  {
    key: 'ready_for_inspection', label: 'Listo', defaultVisible: true,
    getValue: s => s.ready_for_inspection ? 'sí' : 'no',
    render:   s => s.ready_for_inspection && s.estado_general !== 'cerrado'
      ? <span className="text-green-600 font-bold">✓</span>
      : <span className="text-gray-300">—</span>,
    thClass: 'text-center', tdClass: 'text-center',
  },
  {
    key: 'overall_grade', label: 'Grade', defaultVisible: true,
    getValue: s => s.overall_grade ?? '',
    render:   s => s.report_url
      ? <a href={s.report_url} target="_blank" rel="noopener noreferrer"
           className={`${gradeColor(s.overall_grade)} hover:underline`}>
          {s.overall_grade ?? 'Ver'}
        </a>
      : <span className={gradeColor(s.overall_grade)}>{s.overall_grade ?? '—'}</span>,
  },
  {
    key: 'pallets', label: 'Pallets', defaultVisible: false,
    getValue: s => s.pallets != null ? String(s.pallets) : '',
    render:   s => <>{s.pallets ?? '—'}</>,
    thClass: 'text-right', tdClass: 'text-right',
  },
  {
    key: 'dia_disponible_para_inspeccion', label: 'Día Disp.', defaultVisible: true,
    getValue: s => s.dia_disponible_para_inspeccion ?? '',
    render:   s => <EtaCell eta={s.dia_disponible_para_inspeccion} />,
  },
  {
    key: 'inspection_status', label: 'Inspección', defaultVisible: true,
    getValue: s => s.inspection_status ?? '',
    render:   s => <InspBadge status={s.inspection_status} />,
  },
  {
    key: 'psi_file', label: 'PSI File', defaultVisible: false,
    getValue: s => s.psi_file ?? '',
    render:   s => <span className="font-mono text-gray-500 text-xs">{s.psi_file ?? '—'}</span>,
  },
  {
    key: 'estado_general', label: 'Estado', defaultVisible: true,
    getValue: s => s.estado_general ?? '',
    render:   s => <StateBadge state={s.estado_general} />,
  },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

function statusColor(val: string | null): string {
  if (!val) return 'text-gray-400'
  const v = val.toUpperCase()
  if (v.includes('RELEASED') || v === 'ON TIME' || v.includes('CLEARED')) return 'text-green-700'
  if (v.includes('HOLD') || v.includes('REJECT') || v.includes('FAILED')) return 'text-red-600'
  if (v.includes('PENDING') || v.includes('FUMIGATION') || v.includes('SCH.')) return 'text-amber-600'
  return 'text-gray-700'
}

function gradeColor(grade: string | null): string {
  if (!grade) return 'text-gray-400'
  if (grade.startsWith('A')) return 'text-green-700 font-bold'
  if (grade.startsWith('B')) return 'text-amber-600 font-bold'
  if (grade.startsWith('C')) return 'text-orange-600 font-bold'
  if (grade.startsWith('D')) return 'text-red-600 font-bold'
  return 'text-gray-700'
}

function EtaCell({ eta }: { eta: string | null }) {
  if (!eta) return <span className="text-gray-400">—</span>
  const today = new Date().toISOString().slice(0, 10)
  const [, m, d] = eta.split('-')
  const label = `${m}/${d}`
  if (eta < today) return <span className="text-red-500">{label}</span>
  if (eta === today) return <span className="text-blue-600 font-bold">{label} ●</span>
  return <span className="text-gray-800">{label}</span>
}

function StatusCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-300">—</span>
  return <span className={`${statusColor(value)}`}>{value}</span>
}

function InspBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pendiente:  'bg-gray-100 text-gray-500',
    programada: 'bg-blue-100 text-blue-700',
    completada: 'bg-green-100 text-green-700',
    rechazada:  'bg-red-100 text-red-600',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded font-medium ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded font-medium ${
      state === 'abierto' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
    }`}>
      {state}
    </span>
  )
}

// ─── column picker dropdown ───────────────────────────────────────────────────

function ColPicker({
  visible, onChange,
}: {
  visible: Set<string>
  onChange: (key: string, on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        Columnas
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-52">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Mostrar columnas</p>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-gray-50 rounded px-1">
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  onChange={e => onChange(col.key, e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{col.label}</span>
              </label>
            ))}
          </div>
          <div className="border-t border-gray-100 mt-2 pt-2 flex gap-2">
            <button
              onClick={() => COLUMNS.forEach(c => onChange(c.key, true))}
              className="text-xs text-blue-600 hover:underline"
            >
              Mostrar todas
            </button>
            <span className="text-gray-300">·</span>
            <button
              onClick={() => COLUMNS.forEach(c => onChange(c.key, c.defaultVisible))}
              className="text-xs text-gray-500 hover:underline"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

const DEFAULT_VISIBLE = new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))

type SortState = { key: string; dir: 'asc' | 'desc' } | null

export default function Dashboard({ shipments }: { shipments: Shipment[] }) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  // global filters (top bar)
  const [search, setSearch]             = useState('')
  const [filterCliente, setCliente]     = useState('')
  const [filterEstado, setEstado]       = useState('abierto')
  const [filterCommodity, setCommodity] = useState('')

  // column visibility
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE)

  // per-column filters
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  // sort
  const [sort, setSort] = useState<SortState>(null)

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

  const visibleColumns = useMemo(
    () => COLUMNS.filter(c => visibleCols.has(c.key)),
    [visibleCols],
  )

  // unique values per column — cascading:
  // each column's options come from rows that pass ALL other active filters,
  // so selecting "Alpine Fresh" narrows down Container, Commodity, FDA, etc.
  const colOptions = useMemo(() => {
    const opts: Record<string, string[]> = {}
    for (const col of COLUMNS) {
      const rows = shipments.filter(s => {
        // global bar filters
        if (filterCliente && s.cliente !== filterCliente) return false
        if (filterEstado && s.estado_general !== filterEstado) return false
        if (filterCommodity && s.commodity !== filterCommodity) return false
        if (search) {
          const q = search.toLowerCase()
          const hay = [s.unit_id, s.po, s.shipper, s.vessel, s.commodity, s.psi_file]
            .join(' ').toLowerCase()
          if (!hay.includes(q)) return false
        }
        // per-column filters — skip this column's own filter
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
  }, [shipments, search, filterCliente, filterEstado, filterCommodity, colFilters])

  function toggleCol(key: string, on: boolean) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      on ? next.add(key) : next.delete(key)
      return next
    })
  }

  // when a column's selected value is no longer available (cascaded out), clear it
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

  const clientes = useMemo(
    () => [...new Set(shipments.map(s => s.cliente))].sort(),
    [shipments],
  )
  const commodities = useMemo(
    () => [...new Set(shipments.map(s => s.commodity).filter(Boolean) as string[])].sort(),
    [shipments],
  )

  const baseFiltered = useMemo(() => {
    const q = search.toLowerCase()
    return shipments.filter(s => {
      // global bar filters
      if (filterCliente && s.cliente !== filterCliente) return false
      if (filterEstado && s.estado_general !== filterEstado) return false
      if (filterCommodity && s.commodity !== filterCommodity) return false
      if (q) {
        const hay = [s.unit_id, s.po, s.shipper, s.vessel, s.commodity, s.psi_file]
          .join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      // per-column filters — exact match against selected value
      for (const col of COLUMNS) {
        const fv = colFilters[col.key]
        if (!fv) continue
        if (col.getValue(s) !== fv) return false
      }
      return true
    })
  }, [shipments, search, filterCliente, filterEstado, filterCommodity, colFilters])

  const filtered = useMemo(() => {
    if (!sort) return baseFiltered
    const col = COLUMNS.find(c => c.key === sort.key)
    if (!col) return baseFiltered
    return [...baseFiltered].sort((a, b) => {
      const va = col.getValue(a)
      const vb = col.getValue(b)
      if (va === vb) return 0
      if (!va) return 1
      if (!vb) return -1
      const cmp = va.localeCompare(vb, undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [baseFiltered, sort])

  const hasColFilters = Object.values(colFilters).some(Boolean)

  const stats = {
    total:    shipments.length,
    abiertos: shipments.filter(s => s.estado_general === 'abierto').length,
    listos:   shipments.filter(s => s.ready_for_inspection === 1 && s.estado_general === 'abierto').length,
    cerrados: shipments.filter(s => s.estado_general === 'cerrado').length,
  }

  const lastUpdateIso = shipments.length
    ? shipments.reduce((a, b) =>
        a.ultima_actualizacion > b.ultima_actualizacion ? a : b
      ).ultima_actualizacion
    : null

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ── */}
      <header className="bg-gray-900 text-white px-6 py-4 shadow-lg">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Inspection Master</h1>
            {lastUpdateIso && (
              <p className="text-xs text-gray-400 mt-0.5">Actualizado: {timeAgo(lastUpdateIso)}</p>
            )}
          </div>
          <div className="flex items-start gap-6">
            <Stat label="Total"          value={stats.total}    color="text-white" />
            <Stat label="Abiertos"       value={stats.abiertos} color="text-blue-400" />
            <Stat label="Listos p/Insp." value={stats.listos}   color="text-green-400" />
            <Stat label="Cerrados"       value={stats.cerrados} color="text-gray-400" />
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="self-center ml-2 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Refrescar datos"
            >
              <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Filter bar ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 sticky top-0 z-20 shadow-sm">
        <div className="max-w-screen-2xl mx-auto flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Buscar container, PO, shipper..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <BarSelect value={filterCliente}   onChange={setCliente}   options={clientes}               placeholder="Todos los clientes" />
          <BarSelect value={filterEstado}    onChange={setEstado}    options={['abierto','cerrado']}   placeholder="Todos los estados" />
          <BarSelect value={filterCommodity} onChange={setCommodity} options={commodities}             placeholder="Todos los commodities" />

          {(search || filterCliente || filterEstado || filterCommodity || hasColFilters) && (
            <button
              onClick={() => {
                setSearch(''); setCliente(''); setEstado('abierto')
                setCommodity(''); setColFilters({})
              }}
              className="text-xs text-gray-500 hover:text-gray-800 underline"
            >
              Limpiar todo
            </button>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {filtered.length} de {shipments.length} envíos
            </span>
            <ColPicker visible={visibleCols} onChange={toggleCol} />
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <main className="flex-1 overflow-x-auto px-6 py-4">
        <div className="max-w-screen-2xl mx-auto">
          <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full border-collapse bg-white text-xs">
              <thead className="bg-gray-800 sticky top-[57px] z-10">
                {/* column labels — click to sort */}
                <tr>
                  {visibleColumns.map(col => {
                    const isActive = sort?.key === col.key
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`px-3 py-2.5 text-left font-semibold whitespace-nowrap select-none cursor-pointer hover:bg-gray-700 transition-colors ${col.thClass ?? ''} ${isActive ? 'text-blue-300' : 'text-gray-200'}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          <span className="text-[10px] opacity-60">
                            {isActive ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                      </th>
                    )
                  })}
                </tr>
                {/* per-column filter selects — values from real data */}
                <tr className="bg-gray-700">
                  {visibleColumns.map(col => {
                    const opts = colOptions[col.key] ?? []
                    const active = !!colFilters[col.key]
                    return (
                      <td key={col.key} className="px-2 py-1">
                        <select
                          value={colFilters[col.key] ?? ''}
                          onChange={e => setColFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                          className={`w-full text-xs rounded px-1.5 py-0.5 border focus:outline-none focus:border-blue-400 min-w-[70px] max-w-[200px] ${
                            active
                              ? 'bg-blue-600 text-white border-blue-400'
                              : 'bg-gray-600 text-gray-200 border-gray-500'
                          }`}
                        >
                          <option value="">—</option>
                          {opts.map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {filtered.map(s => {
                  const isCerrado = s.estado_general === 'cerrado'
                  const isListo   = s.ready_for_inspection === 1 && !isCerrado
                  return (
                    <tr
                      key={s.id}
                      className={[
                        'hover:bg-gray-50 transition-colors',
                        isCerrado ? 'opacity-40' : '',
                        isListo ? 'bg-green-50 hover:bg-green-100' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {visibleColumns.map(col => (
                        <td
                          key={col.key}
                          className={`px-3 py-2 whitespace-nowrap ${col.tdClass ?? ''}`}
                        >
                          {col.render(s)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-16 text-center text-sm text-gray-400">
                      No se encontraron envíos con los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-right">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function BarSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="border border-gray-200 rounded-md px-2.5 py-1.5 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
