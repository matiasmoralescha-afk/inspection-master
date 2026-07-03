import { supabase } from '@/lib/supabase'
import type { Staff } from '@/lib/types'

/** Shared by staff-table.tsx and inspectors-table.tsx — both edit rows in the `staff` table. */

export function parseClientsAssigned(raw: string | null): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export async function toggleStaffActive(member: Pick<Staff, 'id' | 'active'>): Promise<number> {
  const newValue = member.active ? 0 : 1
  await supabase.from('staff').update({ active: newValue }).eq('id', member.id)
  return newValue
}

export async function deleteStaffMember(id: number): Promise<void> {
  await supabase.from('staff').delete().eq('id', id)
}
