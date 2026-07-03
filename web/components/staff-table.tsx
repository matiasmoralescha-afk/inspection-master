'use client'

import { useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tag } from '@/components/ui/tag'
import { supabase } from '@/lib/supabase'
import { parseClientsAssigned, toggleStaffActive, deleteStaffMember } from '@/lib/staff-actions'
import type { Staff } from '@/lib/types'

const ROLES = ['inspector', 'editor', 'coordinator'] as const
type Role = typeof ROLES[number]

const ROLE_BADGE: Record<string, string> = {
  inspector: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  editor: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  coordinator: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const CLIENTS_OPTIONS = [
  'Alpine Fresh', 'Prime Time', 'Altar Produce', 'Growers Are Us',
  'GreenFruit', 'Fresh Way', 'Robinson Fresh', 'Square One',
  'AgroPeppers USA', 'Harvest', 'Baja Son', 'Nativa', 'ICON',
  'Sol de Ica', 'Sunkist',
]

const EMPTY_FORM = {
  name: '',
  role: 'inspector' as Role,
  zone: '',
  email: '',
  whatsapp: '',
  clients_assigned: [] as string[],
  active: 1,
}

function StaffModal({
  initial,
  onClose,
  onSave,
}: {
  initial: typeof EMPTY_FORM & { id?: number }
  onClose: () => void
  onSave: (data: typeof EMPTY_FORM & { id?: number }) => Promise<void>
}) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)

  function toggleClient(client: string) {
    setForm(prev => ({
      ...prev,
      clients_assigned: prev.clients_assigned.includes(client)
        ? prev.clients_assigned.filter(item => item !== client)
        : [...prev.clients_assigned, client],
    }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <Modal
      title={form.id ? 'Editar miembro' : 'Agregar miembro'}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="staff-form" icon="check" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      )}
    >
      <form id="staff-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nombre"
          required
          value={form.name}
          onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Rol"
            value={form.role}
            onChange={event => setForm(prev => ({ ...prev, role: event.target.value as Role }))}
            options={ROLES.map(role => ({ value: role, label: role }))}
          />
          <Input
            label="Zona"
            value={form.zone}
            onChange={event => setForm(prev => ({ ...prev, zone: event.target.value }))}
            placeholder="Miami, McAllen…"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))}
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp}
            onChange={event => setForm(prev => ({ ...prev, whatsapp: event.target.value }))}
            placeholder="+1 305 000 0000"
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-tertiary">Clientes asignados</p>
          <div className="flex flex-wrap gap-1.5">
            {CLIENTS_OPTIONS.map(client => {
              const active = form.clients_assigned.includes(client)
              return (
                <button
                  key={client}
                  type="button"
                  onClick={() => toggleClient(client)}
                  className={[
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-accent text-white'
                      : 'bg-surface-sunk text-ink-secondary hover:bg-surface-muted',
                  ].join(' ')}
                >
                  {client}
                </button>
              )
            })}
          </div>
        </div>

        <Switch
          checked={!!form.active}
          onChange={next => setForm(prev => ({ ...prev, active: next ? 1 : 0 }))}
          label={form.active ? 'Activo' : 'Inactivo'}
        />
      </form>
    </Modal>
  )
}

export default function StaffTable({ initialStaff }: { initialStaff: Staff[] }) {
  const [staff, setStaff] = useState<Staff[]>(initialStaff)
  const [modal, setModal] = useState<(typeof EMPTY_FORM & { id?: number }) | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  function openAdd() {
    setModal({ ...EMPTY_FORM })
  }

  function openEdit(member: Staff) {
    setModal({
      id: member.id,
      name: member.name,
      role: member.role as Role,
      zone: member.zone ?? '',
      email: member.email ?? '',
      whatsapp: member.whatsapp ?? '',
      clients_assigned: parseClientsAssigned(member.clients_assigned),
      active: member.active,
    })
  }

  async function handleSave(form: typeof EMPTY_FORM & { id?: number }) {
    const payload = {
      name: form.name,
      role: form.role,
      zone: form.zone || null,
      email: form.email || null,
      whatsapp: form.whatsapp || null,
      clients_assigned: JSON.stringify(form.clients_assigned),
      active: form.active,
    }

    if (form.id) {
      const { data } = await supabase.from('staff').update(payload).eq('id', form.id).select().single()
      if (data) setStaff(prev => prev.map(item => item.id === form.id ? data as Staff : item))
    } else {
      const { data } = await supabase.from('staff').insert(payload).select().single()
      if (data) setStaff(prev => [...prev, data as Staff])
    }

    setModal(null)
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    await deleteStaffMember(deleteId)
    setStaff(prev => prev.filter(member => member.id !== deleteId))
    setDeleteId(null)
    setDeleting(false)
  }

  async function toggleActive(member: Staff) {
    const newValue = await toggleStaffActive(member)
    setStaff(prev => prev.map(item => item.id === member.id ? { ...item, active: newValue } : item))
  }

  return (
    <>
      <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-label text-ink-muted">Registro</p>
            <h2 className="mt-1 text-lg font-semibold text-ink-primary">Todo el personal</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-surface-sunk px-3 py-1.5 text-xs font-semibold text-ink-secondary">
              {staff.length} perfiles
            </span>
            <Button size="sm" icon="plus" onClick={openAdd}>
              Agregar miembro
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-hairline">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="bg-surface-sunk">
                  {['Nombre', 'Rol', 'Zona', 'Clientes', 'WhatsApp', 'Activo', ''].map(header => (
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
                {staff.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                      Sin miembros. Agrega el primero.
                    </td>
                  </tr>
                )}

                {staff.map(member => {
                  const clients = parseClientsAssigned(member.clients_assigned)

                  return (
                    <tr key={member.id} className={`transition-colors hover:bg-surface-muted/50 ${!member.active ? 'opacity-55' : ''}`}>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        <div className="flex items-start gap-3">
                          <Avatar name={member.name} />
                          <div>
                            <p className="text-sm font-semibold text-ink-primary">{member.name}</p>
                            <p className="mt-0.5 text-xs text-ink-muted">{member.email ?? 'Sin correo asignado'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_BADGE[member.role] ?? 'bg-surface-sunk text-ink-secondary'}`}>
                          {member.role}
                        </span>
                      </td>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        {member.zone ? <Tag zone={member.zone} /> : <span className="text-sm text-ink-muted">—</span>}
                      </td>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {clients.length === 0
                            ? <span className="text-sm text-ink-muted">—</span>
                            : clients.map(client => <Tag key={client}>{client}</Tag>)}
                        </div>
                      </td>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        {member.whatsapp
                          ? (
                              <a
                                href={`https://wa.me/${member.whatsapp.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-sm text-sky-600 hover:underline"
                              >
                                {member.whatsapp}
                              </a>
                            )
                          : <span className="text-sm text-ink-muted">—</span>}
                      </td>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        <Switch checked={!!member.active} onChange={() => toggleActive(member)} />
                      </td>
                      <td className="border-b border-hairline/60 px-4 py-4 align-top">
                        <div className="flex items-center gap-1">
                          <IconButton icon="pencil" aria-label={`Editar ${member.name}`} onClick={() => openEdit(member)} />
                          <IconButton icon="trash" aria-label={`Eliminar ${member.name}`} onClick={() => setDeleteId(member.id)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modal && (
        <StaffModal
          initial={modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {deleteId && (
        <Modal
          title="¿Eliminar miembro?"
          onClose={() => setDeleteId(null)}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setDeleteId(null)}>
                Cancelar
              </Button>
              <Button variant="danger" icon="trash" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </>
          )}
        >
          <p className="text-sm text-ink-tertiary">
            Esta acción no se puede deshacer. El miembro se eliminará de Supabase.
          </p>
        </Modal>
      )}
    </>
  )
}
