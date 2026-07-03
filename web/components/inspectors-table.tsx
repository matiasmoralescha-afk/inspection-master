'use client'

import { useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tag } from '@/components/ui/tag'
import { supabase } from '@/lib/supabase'
import { ZONES } from '@/lib/tokens'
import { parseClientsAssigned, toggleStaffActive, deleteStaffMember } from '@/lib/staff-actions'
import type { Staff } from '@/lib/types'

const EMPTY: Omit<Staff, 'id' | 'created_at'> = {
  name: '',
  role: 'inspector',
  zone: null,
  whatsapp: null,
  email: null,
  active: 1,
  clients_assigned: '[]',
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

  function openEdit(inspector: Staff) {
    setForm({
      name: inspector.name,
      role: 'inspector',
      zone: inspector.zone,
      whatsapp: inspector.whatsapp,
      email: inspector.email,
      active: inspector.active,
      clients_assigned: inspector.clients_assigned,
    })
    setClientsInput(parseClientsAssigned(inspector.clients_assigned).join(', '))
    setEditId(inspector.id)
  }

  function closeEdit() {
    setEditId(null)
  }

  function buildPayload() {
    const clients = clientsInput.split(',').map(item => item.trim()).filter(Boolean)
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
    if (!error && data) setInspectors(prev => prev.map(item => item.id === id ? data as Staff : item))
    setSaving(false)
    setEditId(null)
  }

  async function deleteInspector(id: number) {
    if (!confirm('¿Eliminar este inspector?')) return
    setDeleting(id)
    await deleteStaffMember(id)
    setInspectors(prev => prev.filter(item => item.id !== id))
    setDeleting(null)
  }

  async function toggleActive(inspector: Staff) {
    const newValue = await toggleStaffActive(inspector)
    setInspectors(prev => prev.map(item => item.id === inspector.id ? { ...item, active: newValue } : item))
  }

  const FormRow = () => (
    <tr className="bg-surface-muted/70">
      <td colSpan={6} className="border-b border-hairline/60 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            label="Nombre"
            value={form.name}
            onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
            placeholder="Juan Pérez"
          />
          <Select
            label="Zona"
            value={form.zone ?? ''}
            onChange={event => setForm(prev => ({ ...prev, zone: event.target.value || null }))}
            options={ZONES.map(zone => ({ value: zone, label: zone }))}
            placeholder="Sin zona"
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp ?? ''}
            onChange={event => setForm(prev => ({ ...prev, whatsapp: event.target.value || null }))}
            placeholder="+1 305 000 0000"
          />
          <Input
            label="Email"
            value={form.email ?? ''}
            onChange={event => setForm(prev => ({ ...prev, email: event.target.value || null }))}
            placeholder="juan@eliteqa.app"
          />
          <div className="sm:col-span-2 xl:col-span-4">
            <Input
              label="Clientes asignados"
              value={clientsInput}
              onChange={event => setClientsInput(event.target.value)}
              placeholder="Alpine Fresh, Prime Time, Altar Produce"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="check"
            onClick={() => editId === 'new' ? saveNew() : saveEdit(editId as number)}
            disabled={saving || !form.name}
          >
            {saving ? 'Guardando…' : 'Guardar'}
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
          {inspectors.filter(inspector => inspector.active).length} activos
        </span>
        <Button size="sm" icon="plus" onClick={openNew}>
          Nuevo inspector
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left">
          <thead>
            <tr className="bg-surface-sunk">
              {['Inspector', 'Zona', 'Clientes', 'WhatsApp', 'Activo', 'Acciones'].map(header => (
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
            {inspectors.map(inspector => {
              const clients = parseClientsAssigned(inspector.clients_assigned)

              if (editId === inspector.id) return <FormRow key={inspector.id} />

              return (
                <tr key={inspector.id} className={`transition-colors hover:bg-surface-muted/50 ${!inspector.active ? 'opacity-55' : ''}`}>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex items-start gap-3">
                      <Avatar name={inspector.name} />
                      <div>
                        <p className="text-sm font-semibold text-ink-primary">{inspector.name}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">{inspector.email ?? 'Sin correo asignado'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    {inspector.zone
                      ? <Tag zone={inspector.zone} />
                      : <span className="text-sm text-ink-muted">—</span>}
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {clients.length === 0
                        ? <span className="text-sm text-ink-muted">—</span>
                        : clients.map(client => <Tag key={client}>{client}</Tag>)}
                    </div>
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    {inspector.whatsapp
                      ? (
                          <a
                            href={`https://wa.me/${inspector.whatsapp.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm text-sky-600 hover:underline"
                          >
                            {inspector.whatsapp}
                          </a>
                        )
                      : <span className="text-sm text-ink-muted">—</span>}
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <Switch
                      checked={!!inspector.active}
                      onChange={() => toggleActive(inspector)}
                    />
                  </td>
                  <td className="border-b border-hairline/60 px-4 py-4 align-top">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" icon="pencil" onClick={() => openEdit(inspector)}>
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon="trash"
                        onClick={() => deleteInspector(inspector.id)}
                        disabled={deleting === inspector.id}
                      >
                        {deleting === inspector.id ? 'Eliminando…' : 'Eliminar'}
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
