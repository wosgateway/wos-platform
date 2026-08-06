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

        // ===== Rebrand: Hospital-first -> Life-first =====
        // เดิม: primary #0d7c66 (เขียวเข้มโทน medical), accent #f59e0b (amber)
        // ใหม่: soft sage green + warm sand/gold -> ความรู้สึก premium wellness
        // แทนที่จะเป็น "โรงพยาบาล" ให้รู้สึกเป็น "รีสอร์ตดูแลสุขภาพ"
        primary: {
          DEFAULT: '#5b8c6e', // soft sage green
          light: '#eef4ef',   // pale sage tint (แทน primary-light เดิม)
          dark: '#3f6b53',    // deep sage สำหรับ hover/active
        },
        accent: '#c9a15a', // warm gold/sand (แทน amber เดิม)
        sand: {
          DEFAULT: '#f6f1e7', // warm sand background — ใช้แทนพื้นขาวล้วนในบาง section
          dark: '#eee5d3',
        },
        slateWarm: {
          // slate ที่ลดความ "เย็น/คลินิก" ลงเล็กน้อย ใช้แทน slate-900/500 เดิมได้ถ้าต้องการ
          900: '#2b2a26',
          500: '#6b6a63',
        },
      },
      fontFamily: {
        sans: ['var(--font-prompt)', 'Noto Sans Lao', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
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
