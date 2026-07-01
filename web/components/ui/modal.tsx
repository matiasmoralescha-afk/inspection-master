'use client'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from './icon'

interface ModalProps {
  open?: boolean
  title?: string
  onClose?: () => void
  footer?: React.ReactNode
  width?: number
  children?: React.ReactNode
}

export function Modal({ open = true, title, onClose, footer, width = 512, children }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog" aria-modal aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: width }}
        className="w-full overflow-hidden rounded-2xl border border-hairline bg-surface shadow-2xl"
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Cerrar" className="text-ink-muted">
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-3 px-6 pb-5">{footer}</div>}
      </div>
    </div>
  )
}
