'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Staff } from '@/lib/types'

const ROLE_STYLES: Record<string, string> = {
  inspector:   'border-emerald-200 bg-emerald-50 text-emerald-700',
  editor:      'border-sky-200 bg-sky-50 text-sky-700',
  coordinator: 'border-amber-200 bg-amber-50 text-amber-700',
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
    <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-slate-950">
              {['Nombre', 'Rol', 'Zona', 'Clientes', 'WhatsApp', 'Activo'].map(h => (
                <th key={h} className="px-4 py-3.5 text-[11px] font-semibold text-slate-300 uppercase tracking-[0.24em] whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map(m => {
              const clients = parseClients(m.clients_assigned)
              return (
                <tr key={m.id} className={`transition-colors hover:bg-slate-50/80 ${!m.active ? 'opacity-[0.55]' : ''}`}>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${m.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div>
                        <span className="block text-[14px] font-semibold text-slate-900">{m.name}</span>
                        <span className="block text-[12px] text-slate-400">
                          {m.email ?? 'Sin correo asignado'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${ROLE_STYLES[m.role] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <span className="text-[13px] text-slate-600">{m.zone ?? '—'}</span>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {clients.length === 0
                        ? <span className="text-slate-300 text-[13px]">—</span>
                        : clients.map(c => (
                            <span key={c} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                              {c}
                            </span>
                          ))
                      }
                    </div>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    {m.whatsapp
                      ? <a href={`https://wa.me/${m.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                           className="font-mono text-[13px] text-sky-700 hover:text-sky-900 hover:underline">
                          {m.whatsapp}
                        </a>
                      : <span className="text-slate-300 text-[13px]">—</span>
                    }
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <button
                      onClick={() => toggleActive(m)}
                      disabled={saving === m.id}
                      aria-label={`${m.active ? 'Desactivar' : 'Activar'} ${m.name}`}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset transition-colors focus:outline-none disabled:opacity-50 ${
                        m.active ? 'bg-emerald-500 ring-emerald-400/60' : 'bg-slate-200 ring-slate-300'
                      }`}
                    >
                      <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform ${
                        m.active ? 'translate-x-5' : 'translate-x-1'
                      }`} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
