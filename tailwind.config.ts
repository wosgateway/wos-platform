import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ===== shadcn/ui base tokens — map to CSS variables in globals.css =====
        // These are required because globals.css uses border-border, bg-background,
        // text-foreground, outline-ring/50 etc. Without these, Tailwind doesn't
        // recognize those utility classes and the build fails.
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--primary-foreground)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },

        // ===== Rebrand v1: Hospital-first -> Life-first (KEEP — still used across
        // existing components: btn-primary, TrustBar, cards, etc.) =====
        primary: {
          DEFAULT: '#5b8c6e', // soft sage green
          light: '#eef4ef',
          dark: '#3f6b53',
        },
        accent: {
          DEFAULT: '#c9a15a', // warm gold/sand
          ink: '#8a6a2e', // WCAG-AA text-safe variant (~5.0:1 on white)
        },
        sand: {
          DEFAULT: '#f6f1e7',
          dark: '#eee5d3',
        },
        slateWarm: {
          900: '#2b2a26',
          500: '#6b6a63',
        },

        // ===== Rebrand v2: "WOS.os" platform redesign (NEW — Step 1 of the
        // homepage rebuild, see mockup). Namespaced separately from
        // primary/accent above so nothing existing breaks. Only apply these
        // inside the new components built in Step 2+; do not retrofit old
        // components with these classes yet. =====
        navy: {
          DEFAULT: '#0B1E3D', // Deep Navy — header/hero dark sections, footer
          light: '#132A52',   // hover/secondary panels on dark bg
          dark: '#071428',    // deepest shade — WOS.os center node, footer base
        },
        medicalBlue: {
          DEFAULT: '#1D63A6', // Medical Blue — icons, links, secondary CTAs
          light: '#E8F1FA',   // pale tint for badges/backgrounds
          dark: '#144A80',    // hover/active state
        },
        gold: {
          DEFAULT: '#C9974A', // Warm Gold — primary CTA ("Start Your Journey")
          light: '#F5EBD8',   // tint for badges/highlights
          dark: '#A67A32',    // hover/active state
          ink: '#8C6428',     // WCAG-AA text-safe variant on white/sand (~4.6:1)
        },
      },
      fontFamily: {
        sans: ['var(--font-prompt)', 'Noto Sans Lao', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        // ===== WOS.os Typography scale (fluid via clamp — spec ranges below) =====
        // h1: 56–72px   h2: 40–48px   h3: 24–30px   body: 16–18px
        h1: [
          'clamp(3.5rem, 3vw + 2.5rem, 4.5rem)',
          { lineHeight: '1.05', fontWeight: '700', letterSpacing: '-0.02em' },
        ],
        h2: [
          'clamp(2.5rem, 1.5vw + 2.1rem, 3rem)',
          { lineHeight: '1.15', fontWeight: '700', letterSpacing: '-0.01em' },
        ],
        h3: [
          'clamp(1.5rem, 0.7vw + 1.3rem, 1.875rem)',
          { lineHeight: '1.25', fontWeight: '600' },
        ],
        'body-lg': [
          'clamp(1rem, 0.2vw + 0.95rem, 1.125rem)',
          { lineHeight: '1.6', fontWeight: '400' },
        ],
      },
      boxShadow: {
        card: '0 4px 20px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
        'card-hover': '0 12px 40px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.03)',
      },
    },
  },
  plugins: [],
};
export default config;
