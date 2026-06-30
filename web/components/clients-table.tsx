'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/lib/types'

const MODE_STYLES: Record<string, string> = {
  ocean:     'border-sky-200 bg-sky-50 text-sky-700',
  air:       'border-emerald-200 bg-emerald-50 text-emerald-700',
  terrestre: 'border-amber-200 bg-amber-50 text-amber-700',
  repack:    'border-purple-200 bg-purple-50 text-purple-700',
  rejection: 'border-rose-200 bg-rose-50 text-rose-700',
}

const EMPTY: Omit<Client, 'id' | 'created_at'> = {
  display_name: '',
  slug: '',
  locations: '[]',
  known_modes: '[]',
  cutoff_hour: null,
  active: 1,
}

function parseArr(raw: string | null): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export default function ClientsTable({ initialClients }: { initialClients: Client[] }) {
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [saving, setSaving] = useState<number | 'new' | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [locInput, setLocInput] = useState('')
  const [modeInput, setModeInput] = useState('')

  function openEdit(c: Client) {
    setForm({
      display_name: c.display_name,
      slug: c.slug,
      locations: c.locations ?? '[]',
      known_modes: c.known_modes ?? '[]',
      cutoff_hour: c.cutoff_hour,
      active: c.active,
    })
    setLocInput(parseArr(c.locations).join(', '))
    setModeInput(parseArr(c.known_modes).join(', '))
    setEditId(c.id)
  }

  function openNew() {
    setForm({ ...EMPTY })
    setLocInput('')
    setModeInput('')
    setEditId('new')
  }

  function closeEdit() { setEditId(null) }

  function syncForm() {
    const locs = locInput.split(',').map(s => s.trim()).filter(Boolean)
    const modes = modeInput.split(',').map(s => s.trim()).filter(Boolean)
    return {
      ...form,
      locations: JSON.stringify(locs),
      known_modes: JSON.stringify(modes),
    }
  }

  async function saveNew() {
    setSaving('new')
    const payload = syncForm()
    if (!payload.slug) payload.slug = slugify(payload.display_name)
    const { data, error } = await supabase.from('clients').insert(payload).select().single()
    if (!error && data) setClients(prev => [...prev, data as Client])
    setSaving(null)
    setEditId(null)
  }

  async function saveEdit(id: number) {
    setSaving(id)
    const payload = syncForm()
    const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single()
    if (!error && data) setClients(prev => prev.map(c => c.id === id ? data as Client : c))
    setSaving(null)
    setEditId(null)
  }

  async function deleteClient(id: number) {
    if (!confirm('¿Eliminar este cliente?')) return
    setDeleting(id)
    await supabase.from('clients').delete().eq('id', id)
    setClients(prev => prev.filter(c => c.id !== id))
    setDeleting(null)
  }

  async function toggleActive(c: Client) {
    const newVal = c.active ? 0 : 1
    await supabase.from('clients').update({ active: newVal }).eq('id', c.id)
    setClients(prev => prev.map(x => x.id === c.id ? { ...x, active: newVal } : x))
  }

  const FormRow = () => (
    <tr className="bg-slate-50">
      <td className="border-b border-slate-200/70 px-4 py-3" colSpan={5}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Nombre</label>
            <input
              value={form.display_name}
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value, slug: slugify(e.target.value) }))}
              placeholder="Alpine Fresh"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Localidades</label>
            <input
              value={locInput}
              onChange={e => setLocInput(e.target.value)}
              placeholder="Miami, Texas, Los Angeles"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Modos</label>
            <input
              value={modeInput}
              onChange={e => setModeInput(e.target.value)}
              placeholder="ocean, air, terrestre"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cutoff</label>
            <input
              type="number" min={0} max={23}
              value={form.cutoff_hour ?? ''}
              onChange={e => setForm(f => ({ ...f, cutoff_hour: e.target.value ? Number(e.target.value) : null }))}
              placeholder="17"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => editId === 'new' ? saveNew() : saveEdit(editId as number)}
            disabled={saving !== null || !form.display_name}
            className="rounded-xl bg-slate-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving !== null ? 'Guardando…' : 'Guardar'}
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
        <span className="text-[12px] text-slate-400">{clients.filter(c => c.active).length} activos</span>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-slate-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo cliente
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-slate-950">
              {['Cliente', 'Localidades', 'Modos', 'Cutoff', 'Acciones'].map(h => (
                <th key={h} className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editId === 'new' && <FormRow />}
            {clients.map(c => (
              editId === c.id ? (
                <FormRow key={c.id} />
              ) : (
                <tr key={c.id} className={`transition-colors hover:bg-slate-50/80 ${!c.active ? 'opacity-50' : ''}`}>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(c)}
                        aria-label={`${c.active ? 'Desactivar' : 'Activar'} ${c.display_name}`}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ring-1 ring-inset transition-colors focus:outline-none ${
                          c.active ? 'bg-emerald-500 ring-emerald-400/60' : 'bg-slate-200 ring-slate-300'
                        }`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                          c.active ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      </button>
                      <span className="text-[14px] font-semibold text-slate-900">{c.display_name}</span>
                    </div>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <span className="text-[13px] text-slate-600">
                      {parseArr(c.locations).join(' · ') || '—'}
                    </span>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {parseArr(c.known_modes).map(m => (
                        <span key={m} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] ${MODE_STYLES[m] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                          {m}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <span className="text-[13px] text-slate-600">
                      {c.cutoff_hour != null ? `${c.cutoff_hour}:00` : '—'}
                    </span>
                  </td>
                  <td className="border-b border-slate-200/70 px-4 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => deleteClient(c.id)}
                        disabled={deleting === c.id}
                        className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[12px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {deleting === c.id ? '…' : 'Eliminar'}
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
