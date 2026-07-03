'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Shipment } from '@/lib/types'
import { MODE_STYLES, type ShippingMode } from '@/lib/tokens'

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
  const atrasada = !!dia && dia < hoy && !s.report_sent
  const modo = (s.tipo_carga ?? 'ocean') as ShippingMode

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 py-2.5 last:border-0">
      <span className="font-mono text-[13px] font-semibold text-slate-900">
        {s.unit_id ?? s.po ?? '—'}
      </span>
      {s.unit_id && s.po && (
        <span className="font-mono text-[12px] text-slate-400">PO {s.po}</span>
      )}
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${MODE_STYLES[modo] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
        {s.tipo_carga}
      </span>
      <span className="text-[13px] text-slate-600">
        {s.commodity ?? 'Sin commodity'}
        {s.country_of_origin ? ` · ${s.country_of_origin}` : ''}
        {s.pallets ? ` · ${s.pallets} pallets` : ''}
      </span>
      <span className="ml-auto flex items-center gap-2 text-[12px]">
        {s.inspector?.name && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
            {s.inspector.name}
          </span>
        )}
        {mostrarDia && dia && (
          <span className="text-slate-500">{fmtCorta(dia)}</span>
        )}
        {atrasada && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            Atrasada desde {fmtCorta(dia)}
          </span>
        )}
        {!dia && !s.report_sent ? (
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-500 ring-1 ring-inset ring-slate-200">
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
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {z.location}
            </h3>
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
              {z.total}
            </span>
          </div>
          <div className="space-y-3">
            {z.grupos.map(g => (
              <div key={g.cliente} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[14px] font-semibold text-slate-900">{g.cliente}</p>
                  <span className="text-[12px] text-slate-400">
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
  const [zonaFiltro, setZonaFiltro] = useState<string>('Todas')

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
    return ['Todas', ...[...set].sort()]
  }, [datos])

  const filtrar = (items: Shipment[]) =>
    zonaFiltro === 'Todas'
      ? items
      : items.filter(s => (s.location?.trim() || 'Sin ubicación') === zonaFiltro)

  const hoyF = filtrar(datos.paraHoy)
  const reinspF = filtrar(datos.reinspecciones)
  const bloqF = filtrar(datos.bloqueadas)
  const proxF = filtrar(datos.proximas)

  const atrasadas = hoyF.filter(s => {
    const dia = s.dia_disponible_para_inspeccion?.slice(0, 10)
    return !!dia && dia < hoy
  }).length

  const tituloFecha = new Date().toLocaleDateString('es', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="min-h-screen bg-[var(--canvas-950)] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* ── Header ── */}
        <header className="glass-panel relative overflow-hidden rounded-[32px] p-6 sm:p-8">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_52%)]" />
            <div className="absolute -bottom-20 left-24 h-48 w-48 rounded-full bg-sky-300/10 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:border-white/20 hover:bg-white/10"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Volver al dashboard
              </Link>

              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.32em] text-emerald-200/80">
                Plan operativo del día
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl capitalize">
                {tituloFecha}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                Inspecciones a realizar hoy por cliente y puerto, reinspecciones que vencen,
                cargas bloqueadas en fumigación y lo que llega en los próximos 7 días.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[26rem]">
              {[
                ['Para hoy', hoyF.length, atrasadas ? `${atrasadas} atrasadas` : 'al día', 'text-emerald-200'],
                ['Reinspecciones', reinspF.length, 'vencen hoy o antes', 'text-amber-200'],
                ['Bloqueadas', bloqF.length, 'fumigación pendiente', 'text-rose-200'],
                ['Próximos 7 días', proxF.length, 'para planificar', 'text-sky-200'],
              ].map(([label, value, hint, tone]) => (
                <div key={label as string} className="rounded-[24px] border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <p className={`text-3xl font-semibold tracking-tight ${tone}`}>{value}</p>
                    <p className="text-right text-xs text-slate-400">{hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </header>

        {/* ── Filtro por zona ── */}
        {zonasDisponibles.length > 2 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {zonasDisponibles.map(z => (
              <button
                key={z}
                onClick={() => setZonaFiltro(z)}
                className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  zonaFiltro === z
                    ? 'bg-white text-slate-900'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {z}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-6">

          {/* ── Para hoy ── */}
          <section className="data-panel rounded-[28px] p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Hoy</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  Inspecciones a realizar
                </h2>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                {hoyF.length} pendientes
              </span>
            </div>
            {hoyF.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-[14px] text-slate-500">
                Nada pendiente para hoy{zonaFiltro !== 'Todas' ? ` en ${zonaFiltro}` : ''}. Las cargas nuevas aparecen aquí cuando quedan listas para inspección.
              </p>
            ) : (
              <SeccionZonas zonas={agruparPorZonaYCliente(hoyF)} hoy={hoy} />
            )}
          </section>

          {/* ── Reinspecciones ── */}
          {reinspF.length > 0 && (
            <section className="data-panel rounded-[28px] p-5 sm:p-6">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                    Seguimiento
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                    Reinspecciones vencidas
                  </h2>
                  <p className="mt-1 text-[13px] text-slate-500">
                    Regla Altar TX: nueva revisión a los 4 días del reporte.
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
                  {reinspF.length} por revisar
                </span>
              </div>
              <div className="space-y-2">
                {reinspF.map(s => (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                    <span className="font-mono text-[13px] font-semibold text-slate-900">
                      {s.unit_id ?? s.po ?? '—'}
                    </span>
                    <span className="text-[13px] text-slate-600">
                      {s.cliente} · {s.commodity ?? '—'}
                      {s.location ? ` · ${s.location}` : ''}
                    </span>
                    <span className="ml-auto text-[12px] font-semibold text-amber-800">
                      Reporte {fmtCorta(s.report_date)} → vencía {fmtCorta(s.reinspection_due_date)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Bloqueadas ── */}
          {bloqF.length > 0 && (
            <section className="data-panel rounded-[28px] p-5 sm:p-6">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                    En espera
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                    En bodega, bloqueadas por fumigación
                  </h2>
                </div>
                <span className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-800">
                  {bloqF.length} bloqueadas
                </span>
              </div>
              <div className="space-y-2">
                {bloqF.map(s => (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="font-mono text-[13px] font-semibold text-slate-900">
                      {s.unit_id ?? s.po ?? '—'}
                    </span>
                    <span className="text-[13px] text-slate-600">
                      {s.cliente} · {s.commodity ?? '—'}
                      {s.location ? ` · ${s.location}` : ''}
                    </span>
                    <span className="ml-auto rounded-full bg-white px-2.5 py-0.5 text-[12px] text-slate-600 ring-1 ring-inset ring-slate-200">
                      {s.fumigation_status || 'Fumigación pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Próximos 7 días ── */}
          <section className="data-panel rounded-[28px] p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Planificación
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  Próximos 7 días
                </h2>
                <p className="mt-1 text-[13px] text-slate-500">
                  Estimado por fecha disponible o ETA — útil para asignar inspectores.
                </p>
              </div>
              <span className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-800">
                {proxF.length} en camino
              </span>
            </div>
            {proxF.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-[14px] text-slate-500">
                Sin llegadas estimadas en la próxima semana{zonaFiltro !== 'Todas' ? ` para ${zonaFiltro}` : ''}.
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
