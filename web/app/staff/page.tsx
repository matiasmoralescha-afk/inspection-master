import { createClient } from '@supabase/supabase-js'
import type { Staff } from '@/lib/types'
import StaffTable from '@/components/staff-table'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { StatCard } from '@/components/ui/stat-card'

async function getStaff(): Promise<Staff[]> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await client
    .from('staff')
    .select('*')
    .order('role')
    .order('name')

  if (error) {
    console.error('Supabase error:', error)
    return []
  }

  return (data ?? []) as Staff[]
}

export const revalidate = 60

export default async function StaffPage() {
  const staff = await getStaff()

  const activeCount    = staff.filter(m => m.active).length
  const inspectors     = staff.filter(m => m.role === 'inspector').length
  const coordinators   = staff.filter(m => m.role === 'coordinator').length
  const inactiveCount  = staff.length - activeCount

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
                Configuración operativa
              </p>
              <h1 className="text-2xl font-semibold text-ink-primary">Equipo</h1>
              <p className="mt-1 text-sm text-ink-tertiary">
                Gestión de inspectores, coordinadores y editores operativos.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Activos" value={activeCount} hint="en operación" tone="emerald" />
          <StatCard label="Inspectores" value={inspectors} hint="en campo" tone="blue" />
          <StatCard label="Coordinadores" value={coordinators} hint="soporte operativo" tone="amber" />
          <StatCard label="Inactivos" value={inactiveCount} hint="fuera de rotación" tone="slate" />
        </div>

        <StaffTable initialStaff={staff} />
      </div>
    </div>
  )
}
