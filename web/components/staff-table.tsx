'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Staff } from '@/lib/types'

const ROLE_STYLES: Record<string, string> = {
  inspector:   'bg-blue-100 text-blue-700',
  editor:      'bg-purple-100 text-purple-700',
  coordinator: 'bg-amber-100 text-amber-700',
}

export default function StaffTable({ initialStaff }: { initialStaff: Staff[] }) {
  const [staff, setStaff] = useState<Staff[]>(initialStaff)
  const [saving, setSaving] = useState<number | null>(null)

  async function toggleActive(member: Staff) {
    setSaving(member.id)
    const newVal = member.active ? 0 : 1
    await supabase.from('staff').update({ active: newVal }).eq('id', member.id)
    setStaff(prev => prev.map(m => m.id === member.id ? { ...m, active: newVal } : m))
    setSaving(null)
  }

  function parseClients(raw: string | null): string[] {
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return [] }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-slate-800">
            {['Nombre', 'Rol', 'Zona', 'Clientes', 'WhatsApp', 'Activo'].map(h => (
              <th key={h} className="px-4 py-3 text-[11px] font-semibold text-slate-300 uppercase tracking-wider whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {staff.map(m => {
            const clients = parseClients(m.clients_assigned)
            return (
              <tr key={m.id} className={`transition-colors hover:bg-slate-50 ${!m.active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <span className="text-[14px] font-medium text-slate-900">{m.name}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${ROLE_STYLES[m.role] ?? 'bg-slate-100 text-slate-600'}`}>
                    {m.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[13px] text-slate-600">{m.zone ?? '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {clients.length === 0
                      ? <span className="text-slate-300 text-[13px]">—</span>
                      : clients.map(c => (
                          <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">
                            {c}
                          </span>
                        ))
                    }
                  </div>
                </td>
                <td className="px-4 py-3">
                  {m.whatsapp
                    ? <a href={`https://wa.me/${m.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                         className="text-[13px] text-blue-600 hover:underline font-mono">
                        {m.whatsapp}
                      </a>
                    : <span className="text-slate-300 text-[13px]">—</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(m)}
                    disabled={saving === m.id}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                      m.active ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                      m.active ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
