'use client'

import { useState, useMemo } from 'react'
import type { Shipment } from '@/lib/types'

// ─── helpers ────────────────────────────────────────────────────────────────

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
  if (eta < today) return <span className="text-red-500 text-xs">{label}</span>
  if (eta === today) return <span className="text-blue-600 font-bold text-xs">{label} ●</span>
  return <span className="text-gray-800 text-xs">{label}</span>
}

function StatusCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-300">—</span>
  return <span className={`text-xs ${statusColor(value)}`}>{value}</span>
}

function InspBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pendiente:  'bg-gray-100 text-gray-500',
    programada: 'bg-blue-100 text-blue-700',
    completada: 'bg-green-100 text-green-700',
    rechazada:  'bg-red-100 text-red-600',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
      state === 'abierto' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
    }`}>
      {state}
    </span>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-gray-200 ${className}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-xs whitespace-nowrap ${className}`}>{children}</td>
  )
}

function SelectFilter({
  value, onChange, options, placeholder,
}: {
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

// ─── main component ──────────────────────────────────────────────────────────

export default function Dashboard({ shipments }: { shipments: Shipment[] }) {
  const [search, setSearch]           = useState('')
  const [filterCliente, setCliente]   = useState('')
  const [filterEstado, setEstado]     = useState('abierto')
  const [filterCommodity, setCommodity] = useState('')

  const clientes = useMemo(
    () => [...new Set(shipments.map(s => s.cliente))].sort(),
    [shipments],
  )
  const commodities = useMemo(
    () => [...new Set(shipments.map(s => s.commodity).filter(Boolean) as string[])].sort(),
    [shipments],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return shipments.filter(s => {
      if (filterCliente && s.cliente !== filterCliente) return false
      if (filterEstado && s.estado_general !== filterEstado) return false
      if (filterCommodity && s.commodity !== filterCommodity) return false
      if (q) {
        const hay = [s.unit_id, s.po, s.shipper, s.vessel, s.commodity, s.psi_file]
          .join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [shipments, search, filterCliente, filterEstado, filterCommodity])

  const stats = {
    total:    shipments.length,
    abiertos: shipments.filter(s => s.estado_general === 'abierto').length,
    listos:   shipments.filter(s => s.ready_for_inspection === 1 && s.estado_general === 'abierto').length,
    cerrados: shipments.filter(s => s.estado_general === 'cerrado').length,
  }

  const lastUpdate = shipments.length
    ? shipments.reduce((a, b) =>
        a.ultima_actualizacion > b.ultima_actualizacion ? a : b
      ).ultima_actualizacion.slice(0, 16).replace('T', ' ')
    : null

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ── */}
      <header className="bg-gray-900 text-white px-6 py-4 shadow-lg">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Inspection Master</h1>
            {lastUpdate && (
              <p className="text-xs text-gray-400 mt-0.5">Actualizado: {lastUpdate}</p>
            )}
          </div>
          <div className="flex gap-6">
            <Stat label="Total" value={stats.total} color="text-white" />
            <Stat label="Abiertos" value={stats.abiertos} color="text-blue-400" />
            <Stat label="Listos p/Insp." value={stats.listos} color="text-green-400" />
            <Stat label="Cerrados" value={stats.cerrados} color="text-gray-400" />
          </div>
        </div>
      </header>

      {/* ── Filters ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 sticky top-0 z-10 shadow-sm">
        <div className="max-w-screen-2xl mx-auto flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Buscar container, PO, shipper..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <SelectFilter value={filterCliente} onChange={setCliente} options={clientes} placeholder="Todos los clientes" />
          <SelectFilter
            value={filterEstado}
            onChange={setEstado}
            options={['abierto', 'cerrado']}
            placeholder="Todos los estados"
          />
          <SelectFilter value={filterCommodity} onChange={setCommodity} options={commodities} placeholder="Todos los commodities" />
          {(search || filterCliente || filterEstado || filterCommodity) && (
            <button
              onClick={() => { setSearch(''); setCliente(''); setEstado('abierto'); setCommodity('') }}
              className="text-xs text-gray-500 hover:text-gray-800 underline"
            >
              Limpiar
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">
            {filtered.length} de {shipments.length} envíos
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <main className="flex-1 overflow-x-auto px-6 py-4">
        <div className="max-w-screen-2xl mx-auto">
          <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full border-collapse bg-white">
              <thead className="bg-gray-800">
                <tr>
                  <Th>Cliente</Th>
                  <Th>Container / AWB</Th>
                  <Th>PO</Th>
                  <Th>Commodity</Th>
                  <Th>País</Th>
                  <Th>ETA</Th>
                  <Th>Shipper</Th>
                  <Th>FDA</Th>
                  <Th>USDA</Th>
                  <Th>Customs</Th>
                  <Th className="text-center">Bodega</Th>
                  <Th className="text-center">Listo</Th>
                  <Th>Grade</Th>
                  <Th>Día Disp.</Th>
                  <Th>Inspección</Th>
                  <Th>Estado</Th>
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
                      ].join(' ')}
                    >
                      <Td className="font-medium text-gray-900">{s.cliente}</Td>
                      <Td className="font-mono text-gray-700">{s.unit_id ?? '—'}</Td>
                      <Td className="font-mono text-gray-500">{s.po ?? '—'}</Td>
                      <Td>{s.commodity ?? '—'}</Td>
                      <Td>{s.country_of_origin ?? '—'}</Td>
                      <Td><EtaCell eta={s.eta_fecha} /></Td>
                      <Td className="max-w-[130px] truncate text-gray-600">{s.shipper ?? '—'}</Td>
                      <Td><StatusCell value={s.fda_status} /></Td>
                      <Td className="max-w-[180px] truncate"><StatusCell value={s.agriculture_usda_status} /></Td>
                      <Td><StatusCell value={s.customs_status} /></Td>
                      <Td className="text-center">
                        {s.warehouse_arrival_confirmed ? (
                          <span className="text-green-600">✓</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </Td>
                      <Td className="text-center">
                        {isListo ? (
                          <span className="text-green-600 font-bold">✓</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </Td>
                      <Td>
                        {s.report_url ? (
                          <a
                            href={s.report_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${gradeColor(s.overall_grade)} hover:underline`}
                          >
                            {s.overall_grade ?? 'Ver'}
                          </a>
                        ) : (
                          <span className={gradeColor(s.overall_grade)}>{s.overall_grade ?? '—'}</span>
                        )}
                      </Td>
                      <Td>
                        <EtaCell eta={s.dia_disponible_para_inspeccion} />
                      </Td>
                      <Td><InspBadge status={s.inspection_status} /></Td>
                      <Td><StateBadge state={s.estado_general} /></Td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={16} className="py-16 text-center text-sm text-gray-400">
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
