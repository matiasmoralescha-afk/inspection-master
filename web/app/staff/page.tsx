import { createClient } from '@supabase/supabase-js'
import type { Staff } from '@/lib/types'
import StaffTable from '@/components/staff-table'
import Link from 'next/link'

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

  const inspectors   = staff.filter(m => m.role === 'inspector')
  const editors      = staff.filter(m => m.role === 'editor')
  const coordinators = staff.filter(m => m.role === 'coordinator')

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Equipo</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {staff.filter(m => m.active).length} activos · {inspectors.length} inspectores · {editors.length} editores · {coordinators.length} coordinadores
            </p>
          </div>
        </div>

        {/* Inspectors */}
        {inspectors.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Inspectores
            </h2>
            <StaffTable initialStaff={inspectors} />
          </section>
        )}

        {/* Coordinators */}
        {coordinators.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Coordinadores
            </h2>
            <StaffTable initialStaff={coordinators} />
          </section>
        )}

        {/* Editors */}
        {editors.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Editores
            </h2>
            <StaffTable initialStaff={editors} />
          </section>
        )}
      </div>
    </div>
  )
}
