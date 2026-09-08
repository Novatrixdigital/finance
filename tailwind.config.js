/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Surfaces (CSS vars so the theme toggle can flip them) ──────────
        base: 'rgb(var(--c-base) / <alpha-value>)',         // main background        dark #090B0D
        surface: 'rgb(var(--c-surface) / <alpha-value>)',   // secondary background   dark #111416
        card: 'rgb(var(--c-card) / <alpha-value>)',         // card background        dark #15191C
        elevated: 'rgb(var(--c-elevated) / <alpha-value>)', // elevated card / hover  dark #1A1F22
        raised: 'rgb(var(--c-raised) / <alpha-value>)',     // menus, tooltips, popovers

        // ── Ink ────────────────────────────────────────────────────────────
        ink: 'rgb(var(--c-ink) / <alpha-value>)',               // primary text    dark #F5F5F5
        'ink-dim': 'rgb(var(--c-ink-dim) / <alpha-value>)',     // secondary text  dark #9CA3AF
        'ink-muted': 'rgb(var(--c-ink-muted) / <alpha-value>)', // muted text      dark #6B7280

        // Fixed hexes for charts / SVG / canvas where CSS vars cannot resolve
        night: { 900: '#090B0D', 800: '#111416', 700: '#15191C', 600: '#1A1F22', 500: '#20262A' },

        // ── Accent ──────────────────────────────────────────────────────────
        // `accent` is theme-aware and is what text/borders/tints must use.
        // `lime` stays literal for solid fills that carry black text.
        accent: 'rgb(var(--c-accent) / <alpha-value>)',

        lime: {
          DEFAULT: '#C8FF00',
          soft: '#A8E600',
          deep: '#89BF00',
          glow: 'rgba(200,255,0,0.16)',
        },

        // ── Semantics (theme-aware; see index.css for the light values) ─────
        positive: 'rgb(var(--c-positive) / <alpha-value>)',
        negative: 'rgb(var(--c-negative) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        info: 'rgb(var(--c-info) / <alpha-value>)',

        // ── Light theme surfaces (theme toggle) ─────────────────────────────
        paper: '#FAFAF7',
        'paper-card': '#FFFFFF',
        'paper-ink': '#0B0D0F',
      },
      borderColor: {
        hair: 'var(--c-hair)',
        'hair-strong': 'var(--c-hair-strong)',
        'hair-soft': 'var(--c-hair-soft)',
      },
      backgroundColor: {
        hair: 'var(--c-hair-soft)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        editorial: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Editorial display scale
        'display-sm': ['2.75rem', { lineHeight: '0.98', letterSpacing: '-0.035em', fontWeight: '800' }],
        'display-md': ['3.75rem', { lineHeight: '0.94', letterSpacing: '-0.04em', fontWeight: '800' }],
        'display-lg': ['4.75rem', { lineHeight: '0.9', letterSpacing: '-0.045em', fontWeight: '800' }],
        'display-xl': ['6rem', { lineHeight: '0.88', letterSpacing: '-0.05em', fontWeight: '800' }],
        // Financial numerals
        'figure-sm': ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'figure-md': ['2rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'figure-lg': ['2.75rem', { lineHeight: '1', letterSpacing: '-0.035em', fontWeight: '700' }],
        // Micro labels
        micro: ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      borderRadius: {
        xl2: '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        30: '7.5rem',
        'sidebar': '17rem',
        'rail': '21rem',
      },
      boxShadow: {
        hair: '0 0 0 1px rgba(255,255,255,0.06)',
        lift: '0 20px 50px -25px rgba(0,0,0,0.9)',
        'glow-lime': '0 0 0 1px rgba(200,255,0,0.35), 0 12px 40px -12px rgba(200,255,0,0.35)',
        'inner-hair': 'inset 0 1px 0 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'lime-fade': 'linear-gradient(180deg, rgba(200,255,0,0.14) 0%, rgba(200,255,0,0) 70%)',
        'hair-fade': 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%)',
        'grid-hair':
          'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '56px 56px',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-glow': {
          '0%,100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.55s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 0.4s ease-out both',
        'scale-in': 'scale-in 0.28s cubic-bezier(0.16,1,0.3,1) both',
        'slide-right': 'slide-right 0.3s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-glow': 'pulse-glow 3.5s ease-in-out infinite',
        float: 'float 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
