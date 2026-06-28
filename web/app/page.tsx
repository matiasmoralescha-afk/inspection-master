import { createClient } from '@supabase/supabase-js'
import Dashboard from '@/components/dashboard'
import type { Shipment } from '@/lib/types'

async function getShipments(): Promise<Shipment[]> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await client
    .from('shipments')
    .select('*, inspector:staff(id,name,role,zone)')
    .order('estado_general', { ascending: true })
    .order('eta_fecha', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('Supabase error:', error)
    return []
  }

  return (data ?? []) as Shipment[]
}

// Revalidate every 5 minutes so Vercel serves fresh data without SSR on every request
export const revalidate = 300

export default async function Page() {
  const shipments = await getShipments()
  return <Dashboard shipments={shipments} />
}
