import { createClient } from '@supabase/supabase-js'
import type { Client } from '@/lib/types'
import ClientsTable from '@/components/clients-table'
import Link from 'next/link'
import { StatCard } from '@/components/ui/stat-card'
import { Icon } from '@/components/ui/icon'

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

  const activeCount = clients.filter(c => c.active).length
  const miamiCount  = clients.filter(c => (c.locations ?? '').includes('Miami')).length
  const texasCount  = clients.filter(c => (c.locations ?? '').includes('Texas')).length
  const laCount     = clients.filter(c => (c.locations ?? '').includes('Los Angeles') || (c.locations ?? '').includes('Oxnard')).length

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-secondary mb-4"
          >
            <Icon name="arrowLeft" size={14} />
            Dashboard
          </Link>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-label text-ink-muted mb-1">
                Configuración operativa
              </p>
              <h1 className="text-2xl font-semibold text-ink-primary">Clientes</h1>
              <p className="mt-1 text-sm text-ink-tertiary">
                Registro de clientes activos, localidades y modos de carga.
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Activos"     value={activeCount} hint="en operación"    tone="emerald" />
          <StatCard label="Miami"       value={miamiCount}  hint="con presencia MIA" tone="blue" />
          <StatCard label="Texas"       value={texasCount}  hint="con presencia TX"  tone="amber" />
          <StatCard label="West Coast"  value={laCount}     hint="LAX / Oxnard"      tone="slate" />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">Registro</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-primary">Todos los clientes</h2>
            </div>
            <span className="rounded-full bg-surface-sunk px-3 py-1.5 text-xs font-semibold text-ink-secondary">
              {clients.length} registros
            </span>
          </div>
          <ClientsTable initialClients={clients} />
        </div>

      </div>
    </div>
  )
}
