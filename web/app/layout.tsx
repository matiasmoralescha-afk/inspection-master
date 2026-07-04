import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Inspection Master',
  description: 'Control operativo de inspecciones, estados y seguimiento de calidad',
}

// Inline script prevents dark-mode flash on page load.
// Light (white) is the default — dark only if the user explicitly chose it.
const themeScript = `
(function() {
  try {
    if (localStorage.getItem('eqa-theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-canvas font-ui text-ink-primary antialiased">
        {children}
      </body>
    </html>
  )
}
