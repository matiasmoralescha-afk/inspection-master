import { createClient } from '@supabase/supabase-js'
import type { Staff } from '@/lib/types'
import InspectorsTable from '@/components/inspectors-table'
import Link from 'next/link'
import { StatCard } from '@/components/ui/stat-card'
import { Icon } from '@/components/ui/icon'

async function getInspectors(): Promise<Staff[]> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await client
    .from('staff')
    .select('*')
    .eq('role', 'inspector')
    .order('name')

  if (error) {
    console.error('Supabase error:', error)
    return []
  }

  return (data ?? []) as Staff[]
}

export const revalidate = 60

export default async function InspectoresPage() {
  const inspectors = await getInspectors()

  const activeCount = inspectors.filter(m => m.active).length
  const miamiCount  = inspectors.filter(m => m.zone === 'Miami').length
  const texasCount  = inspectors.filter(m => m.zone === 'Texas').length
  const westCount   = inspectors.filter(m => m.zone && ['Los Angeles', 'Oxnard'].includes(m.zone)).length

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
                Equipo operativo
              </p>
              <h1 className="text-2xl font-semibold text-ink-primary">Inspectores</h1>
              <p className="mt-1 text-sm text-ink-tertiary">
                Registro de inspectores activos, zonas de cobertura y clientes asignados.
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Activos"    value={activeCount} hint="en operación"  tone="emerald" />
          <StatCard label="Miami"      value={miamiCount}  hint="zona MIA"       tone="blue" />
          <StatCard label="Texas"      value={texasCount}  hint="zona TX"        tone="amber" />
          <StatCard label="West Coast" value={westCount}   hint="LAX / Oxnard"   tone="slate" />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">Registro</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-primary">Todos los inspectores</h2>
            </div>
            <span className="rounded-full bg-surface-sunk px-3 py-1.5 text-xs font-semibold text-ink-secondary">
              {inspectors.length} registros
            </span>
          </div>
          <InspectorsTable initialInspectors={inspectors} />
        </div>

      </div>
    </div>
  )
}
