import type { Config } from 'tailwindcss'

const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: c('canvas'),
        surface: {
          DEFAULT: c('surface'),
          muted:   c('surface-muted'),
          sunk:    c('surface-sunk'),
        },
        hairline: {
          DEFAULT: c('border'),
          strong:  c('border-strong'),
        },
        ink: {
          primary:   c('text-primary'),
          secondary: c('text-secondary'),
          tertiary:  c('text-tertiary'),
          muted:     c('text-muted'),
        },
        accent: {
          DEFAULT: c('accent'),
          hover:   c('accent-hover'),
          ink:     c('accent-ink'),
        },
        ok:     { fg: c('ok-fg'),     bg: c('ok-bg'),     border: c('ok-border'),     solid: c('ok-solid')     },
        warn:   { fg: c('warn-fg'),   bg: c('warn-bg'),   border: c('warn-border'),   solid: c('warn-solid')   },
        info:   { fg: c('info-fg'),   bg: c('info-bg'),   border: c('info-border'),   solid: c('info-solid')   },
        danger: { fg: c('danger-fg'), bg: c('danger-bg'), border: c('danger-border'), solid: c('danger-solid') },
      },
      fontFamily: {
        ui:   ['Avenir Next', 'Manrope', 'Segoe UI', 'Helvetica Neue', 'system-ui', 'sans-serif'],
        mono: ['SFMono-Regular', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': '10px',
        xs:    '11px',
        sm:    '12px',
        base:  '13px',
        md:    '14px',
        lg:    '16px',
        xl:    '20px',
        '2xl': '24px',
        '3xl': '30px',
        '4xl': '36px',
      },
      letterSpacing: {
        label: '0.18em',
        wide:  '0.14em',
        caps:  '0.24em',
      },
      borderRadius: {
        lg:    '8px',
        xl:    '12px',
        '2xl': '16px',
        panel: '24px',
        hero:  '32px',
      },
      boxShadow: {
        sm:    '0 1px 3px rgba(15,23,42,0.06)',
        md:    '0 4px 12px rgba(15,23,42,0.08)',
        lg:    '0 10px 20px rgba(15,23,42,0.10)',
        panel: '0 18px 40px rgba(15,23,42,0.08)',
        '2xl': '0 24px 48px rgba(15,23,42,0.18)',
      },
      animation: {
        'toast-in': 'toast-in 220ms cubic-bezier(0.16,1,0.3,1) both',
      },
      keyframes: {
        'toast-in': {
          from: { opacity: '0', transform: 'translate3d(12px,0,0) scale(0.98)' },
          to:   { opacity: '1', transform: 'none' },
        },
      },
    },
  },
  plugins: [],
}

export default config
