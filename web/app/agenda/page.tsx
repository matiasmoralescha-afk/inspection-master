import { createClient } from '@supabase/supabase-js'
import type { Shipment } from '@/lib/types'
import AgendaDiaria from '@/components/agenda-diaria'

async function getShipments(): Promise<Shipment[]> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  // Agenda needs open shipments (por inspeccionar / bloqueadas / próximas)
  // plus closed ones with a reinspection due (Altar TX rule fires post-report).
  const { data, error } = await client
    .from('shipments')
    .select('*, inspector:staff(id,name,role,zone)')
    .or("estado_general.eq.abierto,reinspection_due_date.not.is.null")
    .order('dia_disponible_para_inspeccion', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('Supabase error:', error)
    return []
  }

  return (data ?? []) as Shipment[]
}

// La agenda cambia con cada corrida horaria del agente — revalidar seguido
export const revalidate = 120

export default async function AgendaPage() {
  const shipments = await getShipments()
  return <AgendaDiaria shipments={shipments} />
}
