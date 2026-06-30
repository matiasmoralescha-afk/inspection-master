import { createClient } from '@supabase/supabase-js'
import type { Client } from '@/lib/types'
import ClientsTable from '@/components/clients-table'
import Link from 'next/link'

async function getClients(): Promise<Client[]> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await client
    .from('clients')
    .select('*')
    .order('display_name')

  if (error) {
    console.error('Supabase error:', error)
    return []
  }

  return (data ?? []) as Client[]
}

export const revalidate = 60

export default async function ClientsPage() {
  const clients = await getClients()

  const activeCount  = clients.filter(c => c.active).length
  const miamiCount   = clients.filter(c => (c.locations ?? '').includes('Miami')).length
  const texasCount   = clients.filter(c => (c.locations ?? '').includes('Texas')).length
  const laCount      = clients.filter(c => (c.locations ?? '').includes('Los Angeles') || (c.locations ?? '').includes('Oxnard')).length

  return (
    <div className="min-h-screen bg-[var(--canvas-950)] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-panel relative overflow-hidden rounded-[32px] p-6 sm:p-8">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_52%)]" />
            <div className="absolute -bottom-20 left-24 h-48 w-48 rounded-full bg-emerald-300/10 blur-3xl" />
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
                Configuracion operativa
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Clientes
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                Registro de clientes activos, sus localidades de operacion y modos de carga para enrutar inspecciones correctamente.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[26rem]">
              {[
                ['Activos',     activeCount, 'en operacion',     'text-emerald-200'],
                ['Miami',       miamiCount,  'con presencia MIA', 'text-sky-200'],
                ['Texas',       texasCount,  'con presencia TX',  'text-amber-200'],
                ['West Coast',  laCount,     'LAX / Oxnard',      'text-slate-200'],
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

        <div className="mt-6">
          <section className="data-panel rounded-[28px] p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Registro
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  Todos los clientes
                </h2>
              </div>
              <span className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                {clients.length} registros
              </span>
            </div>
            <ClientsTable initialClients={clients} />
          </section>
        </div>
      </div>
    </div>
  )
}
