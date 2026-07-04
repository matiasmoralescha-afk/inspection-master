'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/* Barra lateral compartida por todas las vistas (montada en app/layout.tsx).
   Oculta en mobile (lg:flex), igual que el diseño original del dashboard. */

function NavItem({
  children, href, label, pathname,
}: {
  children: React.ReactNode
  href?: string
  label: string
  pathname: string
}) {
  const active = href
    ? href === '/' ? pathname === '/' : pathname.startsWith(href)
    : false
  const cls = `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
    active
      ? 'bg-surface-sunk text-ink-primary font-medium'
      : 'text-ink-tertiary hover:bg-gray-50 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-100'
  }`
  const content = (
    <div className={cls}>
      <span className={`shrink-0 ${active ? 'text-ink-secondary' : 'text-ink-muted'}`}>
        {children}
      </span>
      <span>{label}</span>
    </div>
  )
  if (href) return <Link href={href}>{content}</Link>
  return content
}

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav className="hidden w-56 shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 lg:flex">
      {/* Logo */}
      <div className="mb-6 flex items-center gap-2.5 px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">
          IM
        </div>
        <div>
          <p className="text-[12px] font-semibold leading-tight text-ink-primary">Inspection Master</p>
          <p className="text-[11px] text-ink-muted">Elite QA</p>
        </div>
      </div>

      {/* Nav links */}
      <div className="flex-1 space-y-0.5">
        <NavItem href="/" label="Inspecciones" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
        </NavItem>

        <NavItem href="/agenda" label="Agenda" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
          </svg>
        </NavItem>

        <NavItem href="/staff" label="Equipo" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </NavItem>

        <NavItem href="/inspectores" label="Inspectores" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </NavItem>

        <NavItem href="/clients" label="Clientes" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.25 2.25 0 015.25 5.25h13.5A2.25 2.25 0 0121 7.5v9A2.25 2.25 0 0118.75 18.75H5.25A2.25 2.25 0 013 16.5v-9zM7.5 9.75h4.5m-4.5 3h9" />
          </svg>
        </NavItem>

        <NavItem label="Alertas" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 4.5h.008v.008H12v-.008z" />
          </svg>
        </NavItem>

        <NavItem label="Warehouse" pathname={pathname}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        </NavItem>
      </div>

      {/* User */}
      <div className="flex items-center gap-2.5 border-t border-hairline px-3 pt-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[11px] font-bold text-white">
          MM
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink-primary">Matias</p>
          <p className="truncate text-[11px] text-ink-muted">Operador</p>
        </div>
      </div>
    </nav>
  )
}
