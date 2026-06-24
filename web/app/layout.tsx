import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Inspection Master',
  description: 'Dashboard de seguimiento de envíos',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-50 min-h-screen antialiased">{children}</body>
    </html>
  )
}
