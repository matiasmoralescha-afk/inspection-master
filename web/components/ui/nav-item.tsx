import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icon'

interface NavItemProps extends React.HTMLAttributes<HTMLElement> {
  icon?: IconName
  label: string
  active?: boolean
  href?: string
}

export function NavItem({ icon, label, active, href, className, ...rest }: NavItemProps) {
  const El = (href ? 'a' : 'div') as 'a'
  return (
    <El
      href={href}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-md no-underline transition-colors',
        active
          ? 'bg-surface-muted font-medium text-ink-primary'
          : 'text-ink-tertiary hover:bg-surface-muted hover:text-ink-primary',
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} strokeWidth={1.8} className={active ? 'text-ink-secondary' : 'text-ink-muted'} />}
      <span>{label}</span>
    </El>
  )
}
