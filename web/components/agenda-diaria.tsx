'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Shipment } from '@/lib/types'
import { Icon } from '@/components/ui/icon'
import { StatCard } from '@/components/ui/stat-card'
import { Tag } from '@/components/ui/tag'
import { FilterChip } from '@/components/ui/filter-chip'
import type { ShippingMode } from '@/lib/tokens'

/* ── Fechas (día local del navegador) ─────────────────────────────── */

function localISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return localISO(dt)
}

function fmtCorta(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
}

/* ── Estado derivado compartido (una sola fórmula para badge y contador) ── */

function isAtrasada(s: Shipment, hoy: string): boolean {
  const dia = s.dia_disponible_para_inspeccion?.slice(0, 10)
  return !!dia && dia < hoy && !s.report_sent
}

/* ── Agrupación ────────────────────────────────────────────────────── */

type Grupo = { cliente: string; items: Shipment[] }
type Zona = { location: string; grupos: Grupo[]; total: number }

function agruparPorZonaYCliente(items: Shipment[]): Zona[] {
  const zonas = new Map<string, Map<string, Shipment[]>>()
  for (const s of items) {
    const loc = s.location?.trim() || 'Sin ubicación'
    if (!zonas.has(loc)) zonas.set(loc, new Map())
    const porCliente = zonas.get(loc)!
    if (!porCliente.has(s.cliente)) porCliente.set(s.cliente, [])
    porCliente.get(s.cliente)!.push(s)
  }
  return [...zonas.entries()]
    .map(([location, porCliente]) => {
      const grupos = [...porCliente.entries()]
        .map(([cliente, its]) => ({ cliente, items: its }))
        .sort((a, b) => b.items.length - a.items.length)
      return { location, grupos, total: grupos.reduce((n, g) => n + g.items.length, 0) }
    })
    .sort((a, b) => {
      if (a.location === 'Sin ubicación') return 1
      if (b.location === 'Sin ubicación') return -1
      return b.total - a.total
    })
}

/* ── Fila de shipment ──────────────────────────────────────────────── */

function FilaShipment({ s, hoy, mostrarDia }: { s: Shipment; hoy: string; mostrarDia?: boolean }) {
  const dia = s.dia_disponible_para_inspeccion?.slice(0, 10) ?? null
  const atrasada = isAtrasada(s, hoy)
  const modo = (s.tipo_carga ?? 'ocean') as ShippingMode

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline py-2.5 last:border-0">
      <span className="font-mono text-base font-semibold text-ink-primary">
        {s.unit_id ?? s.po ?? '—'}
      </span>
      {s.unit_id && s.po && (
        <span className="font-mono text-sm text-ink-muted">PO {s.po}</span>
      )}
      <Tag mode={modo} />
      <span className="text-base text-ink-tertiary">
        {s.commodity ?? 'Sin commodity'}
        {s.country_of_origin ? ` · ${s.country_of_origin}` : ''}
        {s.pallets ? ` · ${s.pallets} pallets` : ''}
      </span>
      <span className="ml-auto flex items-center gap-2 text-sm">
        {s.inspector?.name && (
          <Tag>{s.inspector.name}</Tag>
        )}
        {mostrarDia && dia && (
          <span className="text-ink-muted">{fmtCorta(dia)}</span>
        )}
        {atrasada && (
          <span className="rounded-full bg-danger-bg px-2 py-0.5 font-semibold text-danger-fg ring-1 ring-inset ring-danger-border">
            Atrasada desde {fmtCorta(dia)}
          </span>
        )}
        {!dia && !s.report_sent ? (
          <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-ink-muted ring-1 ring-inset ring-hairline">
            Sin fecha
          </span>
        ) : null}
      </span>
    </li>
  )
}

/* ── Sección por zona → cliente ────────────────────────────────────── */

function SeccionZonas({ zonas, hoy, mostrarDia }: { zonas: Zona[]; hoy: string; mostrarDia?: boolean }) {
  return (
    <div className="space-y-5">
      {zonas.map(z => (
        <div key={z.location}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-caps text-ink-muted">
              {z.location}
            </h3>
            <span className="rounded-full bg-accent-ink px-2 py-0.5 text-xs font-semibold text-surface">
              {z.total}
            </span>
          </div>
          <div className="space-y-3">
            {z.grupos.map(g => (
              <div key={g.cliente} className="rounded-xl border border-hairline bg-surface-muted/40 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-md font-semibold text-ink-primary">{g.cliente}</p>
                  <span className="text-sm text-ink-muted">
                    {g.items.length} {g.items.length === 1 ? 'inspección' : 'inspecciones'}
                  </span>
                </div>
                <ul>
                  {g.items.map(s => (
                    <FilaShipment key={s.id} s={s} hoy={hoy} mostrarDia={mostrarDia} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Página ────────────────────────────────────────────────────────── */

export default function AgendaDiaria({ shipments }: { shipments: Shipment[] }) {
  const hoy = localISO(new Date())
  const horizonte = addDays(hoy, 7)
  const [zonaFiltro, setZonaFiltro] = useState<string>('')

  const datos = useMemo(() => {
    const abiertos = shipments.filter(s => s.estado_general === 'abierto' && !s.report_sent)

    const paraHoy = abiertos.filter(s => {
      if (!s.ready_for_inspection) return false
      const dia = s.dia_disponible_para_inspeccion?.slice(0, 10)
      return !dia || dia <= hoy // sin fecha pero listas también cuentan para hoy
    })

    const reinspecciones = shipments.filter(s => {
      const due = s.reinspection_due_date?.slice(0, 10)
      return !!due && due <= hoy
    })

    const bloqueadas = abiertos.filter(
      s => s.warehouse_arrival_confirmed && !s.ready_for_inspection,
    )

    const proximas = abiertos.filter(s => {
      const dia = s.dia_disponible_para_inspeccion?.slice(0, 10)
      return !!dia && dia > hoy && dia <= horizonte
    })

    return { paraHoy, reinspecciones, bloqueadas, proximas }
  }, [shipments, hoy, horizonte])

  const zonasDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const s of [...datos.paraHoy, ...datos.reinspecciones, ...datos.bloqueadas, ...datos.proximas]) {
      set.add(s.location?.trim() || 'Sin ubicación')
    }
    return [...set].sort()
  }, [datos])

  const filtrar = (items: Shipment[]) =>
    !zonaFiltro
      ? items
      : items.filter(s => (s.location?.trim() || 'Sin ubicación') === zonaFiltro)

  const hoyF = filtrar(datos.paraHoy)
  const reinspF = filtrar(datos.reinspecciones)
  const bloqF = filtrar(datos.bloqueadas)
  const proxF = filtrar(datos.proximas)

  const atrasadas = hoyF.filter(s => isAtrasada(s, hoy)).length

  const tituloFecha = new Date().toLocaleDateString('es', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* ── Header ── */}
        <div className="mb-8">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-secondary"
          >
            <Icon name="arrowLeft" size={14} />
            Dashboard
          </Link>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-label text-ink-muted">
                Plan operativo del día
              </p>
              <h1 className="text-2xl font-semibold capitalize text-ink-primary">{tituloFecha}</h1>
              <p className="mt-1 text-sm text-ink-tertiary">
                Inspecciones a realizar hoy por cliente y puerto, reinspecciones que vencen,
                cargas bloqueadas en fumigación y lo que llega en los próximos 7 días.
              </p>
            </div>

            {zonasDisponibles.length > 1 && (
              <FilterChip
                label="Zona"
                value={zonaFiltro}
                options={zonasDisponibles}
                onChange={setZonaFiltro}
                allLabel="Todas"
              />
            )}
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Para hoy" value={hoyF.length} hint={atrasadas ? `${atrasadas} atrasadas` : 'al día'} tone={atrasadas ? 'red' : 'emerald'} />
          <StatCard label="Reinspecciones" value={reinspF.length} hint="vencen hoy o antes" tone="amber" />
          <StatCard label="Bloqueadas" value={bloqF.length} hint="fumigación pendiente" tone="red" />
          <StatCard label="Próximos 7 días" value={proxF.length} hint="para planificar" tone="blue" />
        </div>

        <div className="space-y-6">

          {/* ── Para hoy ── */}
          <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">Hoy</p>
                <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                  Inspecciones a realizar
                </h2>
              </div>
              <span className="rounded-full bg-ok-bg px-3 py-1.5 text-xs font-semibold text-ok-fg">
                {hoyF.length} pendientes
              </span>
            </div>
            {hoyF.length === 0 ? (
              <p className="rounded-xl border border-dashed border-hairline bg-surface-muted/50 p-6 text-center text-md text-ink-muted">
                Nada pendiente para hoy{zonaFiltro ? ` en ${zonaFiltro}` : ''}. Las cargas nuevas aparecen aquí cuando quedan listas para inspección.
              </p>
            ) : (
              <SeccionZonas zonas={agruparPorZonaYCliente(hoyF)} hoy={hoy} />
            )}
          </section>

          {/* ── Reinspecciones ── */}
          {reinspF.length > 0 && (
            <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">
                    Seguimiento
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                    Reinspecciones vencidas
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Regla Altar TX: nueva revisión a los 4 días del reporte.
                  </p>
                </div>
                <span className="rounded-full bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn-fg">
                  {reinspF.length} por revisar
                </span>
              </div>
              <div className="space-y-2">
                {reinspF.map(s => (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warn-border bg-warn-bg/50 px-4 py-3">
                    <span className="font-mono text-base font-semibold text-ink-primary">
                      {s.unit_id ?? s.po ?? '—'}
                    </span>
                    <span className="text-base text-ink-tertiary">
                      {s.cliente} · {s.commodity ?? '—'}
                      {s.location ? ` · ${s.location}` : ''}
                    </span>
                    <span className="ml-auto text-sm font-semibold text-warn-fg">
                      Reporte {fmtCorta(s.report_date)} → vencía {fmtCorta(s.reinspection_due_date)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Bloqueadas ── */}
          {bloqF.length > 0 && (
            <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">
                    En espera
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                    En bodega, bloqueadas por fumigación
                  </h2>
                </div>
                <span className="rounded-full bg-danger-bg px-3 py-1.5 text-xs font-semibold text-danger-fg">
                  {bloqF.length} bloqueadas
                </span>
              </div>
              <div className="space-y-2">
                {bloqF.map(s => (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-hairline bg-surface-muted/50 px-4 py-3">
                    <span className="font-mono text-base font-semibold text-ink-primary">
                      {s.unit_id ?? s.po ?? '—'}
                    </span>
                    <span className="text-base text-ink-tertiary">
                      {s.cliente} · {s.commodity ?? '—'}
                      {s.location ? ` · ${s.location}` : ''}
                    </span>
                    <span className="ml-auto rounded-full bg-surface px-2.5 py-0.5 text-sm text-ink-secondary ring-1 ring-inset ring-hairline">
                      {s.fumigation_status || 'Fumigación pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Próximos 7 días ── */}
          <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">
                  Planificación
                </p>
                <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                  Próximos 7 días
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Estimado por fecha disponible o ETA — útil para asignar inspectores.
                </p>
              </div>
              <span className="rounded-full bg-info-bg px-3 py-1.5 text-xs font-semibold text-info-fg">
                {proxF.length} en camino
              </span>
            </div>
            {proxF.length === 0 ? (
              <p className="rounded-xl border border-dashed border-hairline bg-surface-muted/50 p-6 text-center text-md text-ink-muted">
                Sin llegadas estimadas en la próxima semana{zonaFiltro ? ` para ${zonaFiltro}` : ''}.
              </p>
            ) : (
              <SeccionZonas zonas={agruparPorZonaYCliente(proxF)} hoy={hoy} mostrarDia />
            )}
          </section>

        </div>
      </div>
    </div>
  )
}
