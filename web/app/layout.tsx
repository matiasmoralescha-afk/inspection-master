import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Inspection Master',
  description: 'Control operativo de inspecciones, estados y seguimiento de calidad',
}

// Inline script prevents dark-mode flash on page load
const themeScript = `
(function() {
  try {
    var saved = localStorage.getItem('eqa-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
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
