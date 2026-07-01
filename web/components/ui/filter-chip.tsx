'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from './icon'

type Option = string | { value: string; label: string }

interface FilterChipProps {
  label: string
  value?: string
  options?: Option[]
  onChange?: (value: string) => void
  allLabel?: string
  className?: string
}

export function FilterChip({
  label, value = '', options = [], onChange, allLabel = 'Todos', className,
}: FilterChipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = !!value

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-base font-medium transition-colors',
          active
            ? 'border-accent-ink bg-accent-ink text-surface'
            : 'border-hairline bg-surface text-ink-secondary hover:border-hairline-strong',
        )}
      >
        {active ? `${label}: ${value}` : label}
        <Icon name="chevronDown" size={12} strokeWidth={2.5} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 min-w-40 overflow-y-auto rounded-xl border border-hairline bg-surface p-1.5 shadow-lg">
          <button
            type="button"
            onClick={() => { onChange?.(''); setOpen(false) }}
            className="block w-full rounded-lg px-3 py-2 text-left text-base text-ink-muted hover:bg-surface-muted"
          >
            {allLabel}
          </button>
          {options.map(o => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o
            const sel = value === opt.value
            return (
              <button
                key={opt.value} type="button"
                onClick={() => { onChange?.(opt.value); setOpen(false) }}
                className={cn(
                  'block w-full rounded-lg px-3 py-2 text-left text-base hover:bg-surface-muted',
                  sel ? 'font-medium text-ink-primary' : 'text-ink-secondary',
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
