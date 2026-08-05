import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
