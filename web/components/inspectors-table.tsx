'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Staff } from '@/lib/types'

const ZONES = ['Miami', 'Texas', 'Los Angeles', 'Oxnard', 'New Jersey', 'New York']

const EMPTY: Omit<Staff, 'id' | 'created_at'> = {
  name: '',
  role: 'inspector',
  zone: null,
  whatsapp: null,
  email: null,
  active: 1,
  clients_assigned: '[]',
}

function parseArr(raw: string | null): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

const ZONE_COLORS: Record<string, string> = {
  'Miami':       'bg-sky-100 text-sky-700',
  'Texas':       'bg-amber-100 text-amber-700',
  'Los Angeles': 'bg-purple-100 text-purple-700',
  'Oxnard':      'bg-emerald-100 text-emerald-700',
  'New Jersey':  'bg-rose-100 text-rose-700',
  'New York':    'bg-indigo-100 text-indigo-700',
}

export default function InspectorsTable({ initialInspectors }: { initialInspectors: Staff[] }) {
  const [inspectors, setInspectors] = useState<Staff[]>(initialInspectors)
  const [editId, setEditId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState<Omit<Staff, 'id' | 'created_at'>>(EMPTY)
  const [clientsInput, setClientsInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  function openNew() {
    setForm({ ...EMPTY })
    setClientsInput('')
    setEditId('new')
  }

  function openEdit(m: Staff) {
    setForm({
      name: m.name,
      role: 'inspector',
      zone: m.zone,
      whatsapp: m.whatsapp,
      email: m.email,
      active: m.active,
      clients_assigned: m.clients_assigned,
    })
    setClientsInput(parseArr(m.clients_assigned).join(', '))
    setEditId(m.id)
  }

  function closeEdit() { setEditId(null) }

  function buildPayload() {
    const clients = clientsInput.split(',').map(s => s.trim()).filter(Boolean)
    return { ...form, role: 'inspector' as const, clients_assigned: JSON.stringify(clients) }
  }

  async function saveNew() {
    setSaving(true)
    const payload = buildPayload()
    const { data, error } = await supabase.from('staff').insert(payload).select().single()
    if (!error && data) setInspectors(prev => [...prev, data as Staff])
    setSaving(false)
    setEditId(null)
  }

  async function saveEdit(id: number) {
    setSaving(true)
    const payload = buildPayload()
    const { data, error } = await supabase.from('staff').update(payload).eq('id', id).select().single()
    if (!error && data) setInspectors(prev => prev.map(m => m.id === id ? data as Staff : m))
    setSaving(false)
    setEditId(null)
  }

  async function deleteInspector(id: number) {
    if (!confirm('¿Eliminar este inspector?')) return
    setDeleting(id)
    await supabase.from('staff').delete().eq('id', id)
    setInspectors(prev => prev.filter(m => m.id !== id))
    setDeleting(null)
  }

  async function toggleActive(m: Staff) {
    const newVal = m.active ? 0 : 1
    await supabase.from('staff').update({ active: newVal }).eq('id', m.id)
    setInspectors(prev => prev.map(x => x.id === m.id ? { ...x, active: newVal } : x))
  }

  const FormRow = () => (
    <tr className="bg-slate-50">
      <td className="border-b border-slate-200/70 px-4 py-4" colSpan={6}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Nombre</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Juan Pérez"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Zona</label>
            <select
              value={form.zone ?? ''}
              onChange={e => setForm(f => ({ ...f, zone: e.target.value || null }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            >
              <option value="">Sin zona</option>
              {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">WhatsApp</label>
            <input
              value={form.whatsapp ?? ''}
              onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value || null }))}
              placeholder="+1 305 000 0000"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Email</label>
            <input
              value={form.email ?? ''}
              onChange={e => setForm(f => ({ ...f, email: e.target.value || null }))}
              placeholder="juan@eliteqa.app"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Clientes asignados</label>
            <input
              value={clientsInput}
              onChange={e => setClientsInput(e.target.value)}
              placeholder="Alpine Fresh, Prime Time, Altar Produce"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => editId === 'new' ? saveNew() : saveEdit(editId as number)}
            disabled={saving || !form.name}
            className="rounded-xl bg-slate-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            onClick={closeEdit}
            className="rounded-xl border border-slate-200 px-4 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-3">
        <span className="text-[12px] text-slate-400">{inspectors.filter(m => m.active).length} activos</span>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-slate-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo inspector
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-slate-950">
              {['Inspector', 'Zona', 'Clientes', 'WhatsApp', 'Activo', 'Acciones'].map(h => (
                <th key={h} className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editId === 'new' && <FormRow />}
            {inspectors.map(m => (
              editId === m.id ? (
                <FormRow key={m.id} />
              ) : (
                <tr key={m.id} className={`transition-colors hover:bg-slate-50/80 ${!m.active ? 'opacity-50' : ''}`}>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[12px] font-semibold text-emerald-700">
                        {initials(m.name)}
                      </div>
                      <div>
                        <span className="block text-[14px] font-semibold text-slate-900">{m.name}</span>
                        <span className="block text-[12px] text-slate-400">{m.email ?? '—'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    {m.zone
                      ? <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${ZONE_COLORS[m.zone] ?? 'bg-slate-100 text-slate-600'}`}>{m.zone}</span>
                      : <span className="text-[13px] text-slate-300">—</span>
                    }
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {parseArr(m.clients_assigned).length === 0
                        ? <span className="text-[13px] text-slate-300">—</span>
                        : parseArr(m.clients_assigned).map(c => (
                            <span key={c} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{c}</span>
                          ))
                      }
                    </div>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    {m.whatsapp
                      ? <a href={`https://wa.me/${m.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                           className="font-mono text-[13px] text-sky-700 hover:underline">{m.whatsapp}</a>
                      : <span className="text-[13px] text-slate-300">—</span>
                    }
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <button
                      onClick={() => toggleActive(m)}
                      aria-label={`${m.active ? 'Desactivar' : 'Activar'} ${m.name}`}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset transition-colors focus:outline-none ${
                        m.active ? 'bg-emerald-500 ring-emerald-400/60' : 'bg-slate-200 ring-slate-300'
                      }`}
                    >
                      <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform ${
                        m.active ? 'translate-x-5' : 'translate-x-1'
                      }`} />
                    </button>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(m)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => deleteInspector(m.id)}
                        disabled={deleting === m.id}
                        className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[12px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {deleting === m.id ? '…' : 'Eliminar'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
