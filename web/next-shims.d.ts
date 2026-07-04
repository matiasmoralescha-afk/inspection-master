declare module 'next' {
  export interface Metadata {
    title?: string
    description?: string
    [key: string]: unknown
  }

  export interface Viewport {
    [key: string]: unknown
  }

  export type ResolvingMetadata = Promise<Metadata>
  export type ResolvingViewport = Promise<Viewport>

  export interface NextConfig {
    [key: string]: unknown
  }
}

declare module 'next/link' {
  import * as React from 'react'

  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string
    prefetch?: boolean | null
    replace?: boolean
    scroll?: boolean
  }

  const Link: React.ForwardRefExoticComponent<LinkProps & React.RefAttributes<HTMLAnchorElement>>
  export default Link
}

declare module 'next/navigation' {
  export interface AppRouterInstance {
    back(): void
    forward(): void
    push(href: string, options?: { scroll?: boolean }): void
    replace(href: string, options?: { scroll?: boolean }): void
    refresh(): void
    prefetch(href: string): void | Promise<void>
  }

  export function useRouter(): AppRouterInstance
  export function usePathname(): string
}

declare module 'next/types.js' {
  import type { Metadata, Viewport } from 'next'

  export type ResolvingMetadata = Promise<Metadata>
  export type ResolvingViewport = Promise<Viewport>
}

declare module 'next/dist/lib/metadata/types/metadata-interface.js' {
  import type { Metadata, Viewport } from 'next'

  export type ResolvingMetadata = Promise<Metadata>
  export type ResolvingViewport = Promise<Viewport>
}
