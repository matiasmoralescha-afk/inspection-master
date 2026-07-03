'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tag } from '@/components/ui/tag'
import { SHIPPING_MODES, type ShippingMode } from '@/lib/tokens'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/lib/types'

const EMPTY: Omit<Client, 'id' | 'created_at'> = {
  display_name: '',
  slug: '',
  locations: '[]',
  known_modes: '[]',
  cutoff_hour: null,
  active: 1,
}

const KNOWN_MODES = new Set<string>(SHIPPING_MODES)

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

  function openEdit(client: Client) {
    setForm({
      display_name: client.display_name,
      slug: client.slug,
      locations: client.locations ?? '[]',
      known_modes: client.known_modes ?? '[]',
      cutoff_hour: client.cutoff_hour,
      active: client.active,
    })
    setLocInput(parseArr(client.locations).join(', '))
    setModeInput(parseArr(client.known_modes).join(', '))
    setEditId(client.id)
  }

  function openNew() {
    setForm({ ...EMPTY })
    setLocInput('')
    setModeInput('')
    setEditId('new')
  }

  function closeEdit() {
    setEditId(null)
  }

  function syncForm() {
    const locations = locInput.split(',').map(item => item.trim()).filter(Boolean)
    const modes = modeInput.split(',').map(item => item.trim()).filter(Boolean)
    return {
      ...form,
      locations: JSON.stringify(locations),
      known_modes: JSON.stringify(modes),
    }
  }

  async function saveNew() {
    setSaving('new')
    let payload = syncForm()
    if (!payload.slug) payload = { ...payload, slug: slugify(payload.display_name) }
    const { data, error } = await supabase.from('clients').insert(payload).select().single()
    if (!error && data) setClients(prev => [...prev, data as Client])
    setSaving(null)
    setEditId(null)
  }

  async function saveEdit(id: number) {
    setSaving(id)
    const payload = syncForm()
    const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single()
    if (!error && data) setClients(prev => prev.map(client => client.id === id ? data as Client : client))
    setSaving(null)
    setEditId(null)
  }

  async function deleteClient(id: number) {
    if (!confirm('¿Eliminar este cliente?')) return
    setDeleting(id)
    await supabase.from('clients').delete().eq('id', id)
    setClients(prev => prev.filter(client => client.id !== id))
    setDeleting(null)
  }

  async function toggleActive(client: Client) {
    const newValue = client.active ? 0 : 1
    await supabase.from('clients').update({ active: newValue }).eq('id', client.id)
    setClients(prev => prev.map(item => item.id === client.id ? { ...item, active: newValue } : item))
  }

  const FormRow = () => (
    <tr className="bg-surface-muted/70">
      <td colSpan={5} className="border-b border-hairline/60 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            label="Nombre"
            value={form.display_name}
            onChange={event => setForm(prev => ({ ...prev, display_name: event.target.value, slug: slugify(event.target.value) }))}
            placeholder="Alpine Fresh"
          />
          <Input
            label="Localidades"
            value={locInput}
            onChange={event => setLocInput(event.target.value)}
            placeholder="Miami, Texas, Los Angeles"
          />
          <Input
            label="Modos"
            value={modeInput}
            onChange={event => setModeInput(event.target.value)}
            placeholder="ocean, air, terrestre"
          />
          <Input
            label="Cutoff"
            type="number"
            min={0}
            max={23}
            value={form.cutoff_hour ?? ''}
            onChange={event => setForm(prev => ({ ...prev, cutoff_hour: event.target.value ? Number(event.target.value) : null }))}
            placeholder="17"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="check"
            onClick={() => editId === 'new' ? saveNew() : saveEdit(editId as number)}
            disabled={saving !== null || !form.display_name}
          >
            {saving !== null ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button size="sm" variant="secondary" onClick={closeEdit}>
            Cancelar
          </Button>
        </div>
      </td>
    </tr>
  )

  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <span className="text-xs font-semibold uppercase tracking-label text-ink-muted">
          {clients.filter(client => client.active).length} activos
        </span>
        <Button size="sm" icon="plus" onClick={openNew}>
          Nuevo cliente
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="bg-surface-sunk">
              {['Cliente', 'Localidades', 'Modos', 'Cutoff', 'Acciones'].map(header => (
                <th
                  key={header}
                  className="border-b border-hairline px-4 py-3 text-xs font-semibold uppercase tracking-label text-ink-muted whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editId === 'new' && <FormRow />}
            {clients.map(client => {
              const locations = parseArr(client.locations)
              const modes = parseArr(client.known_modes)

              if (editId === client.id) return <FormRow key={client.id} />

              return (
                <tr key={client.id} className={`transition-colors hover:bg-surface-muted/50 ${!client.active ? 'opacity-55' : ''}`}>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex items-start gap-3">
                      <Switch
                        size="sm"
                        checked={!!client.active}
                        onChange={() => toggleActive(client)}
                      />
                      <div>
                        <p className="text-sm font-semibold text-ink-primary">{client.display_name}</p>
                        <p className="mt-0.5 font-mono text-xs text-ink-muted">{client.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {locations.length === 0
                        ? <span className="text-sm text-ink-muted">—</span>
                        : locations.map(location => <Tag key={location} zone={location} />)}
                    </div>
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {modes.length === 0
                        ? <span className="text-sm text-ink-muted">—</span>
                        : modes.map(mode => (
                            KNOWN_MODES.has(mode)
                              ? <Tag key={mode} mode={mode as ShippingMode} />
                              : <Tag key={mode} uppercase>{mode}</Tag>
                          ))}
                    </div>
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <span className="text-sm text-ink-secondary">
                      {client.cutoff_hour != null ? `${client.cutoff_hour}:00` : '—'}
                    </span>
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" icon="pencil" onClick={() => openEdit(client)}>
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon="trash"
                        onClick={() => deleteClient(client.id)}
                        disabled={deleting === client.id}
                      >
                        {deleting === client.id ? 'Eliminando…' : 'Eliminar'}
                      </Button>
                    </div>
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
