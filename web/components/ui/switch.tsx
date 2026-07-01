'use client'
import { cn } from '@/lib/utils'

interface SwitchProps {
  checked?: boolean
  onChange?: (next: boolean) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  label?: string
  className?: string
}

export function Switch({ checked, onChange, size = 'md', disabled, label, className }: SwitchProps) {
  const dims = size === 'sm'
    ? { track: 'h-5 w-9', knob: 'h-3.5 w-3.5', on: 'left-[18px]', off: 'left-1' }
    : { track: 'h-6 w-11', knob: 'h-[18px] w-[18px]', on: 'left-[22px]', off: 'left-1' }

  const control = (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full ring-1 ring-inset transition-colors',
        checked ? 'bg-emerald-500 ring-emerald-400/60' : 'bg-gray-200 ring-hairline-strong dark:bg-slate-700',
        disabled && 'opacity-50', dims.track, className,
      )}
    >
      <span className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left]',
        dims.knob, checked ? dims.on : dims.off,
      )} />
    </button>
  )

  if (!label) return control
  return (
    <span className="inline-flex items-center gap-3">
      {control}
      <span className="text-base text-ink-secondary">{label}</span>
    </span>
  )
}
