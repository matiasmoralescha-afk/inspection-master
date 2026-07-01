import { cn } from '@/lib/utils'
import { Icon } from './icon'

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  placeholder?: string
}

export function SearchInput({ placeholder = 'Buscar…', className, ...rest }: SearchInputProps) {
  return (
    <div className="relative flex min-w-[200px] items-center">
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 text-ink-muted" />
      <input
        type="text" placeholder={placeholder} aria-label={placeholder}
        className={cn(
          'w-full rounded-lg border border-hairline bg-surface py-2 pl-9 pr-4 text-base text-ink-primary outline-none',
          'placeholder:text-ink-muted transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
          className,
        )}
        {...rest}
      />
    </div>
  )
}
