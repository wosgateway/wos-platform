import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Carried over from the original css/style.css :root variables.
        // Figma design system will refine these before public launch —
        // kept as-is for now so the functional migration isn't blocked on design.
        primary: {
          DEFAULT: '#0d7c66',
          light: '#e6f4f1',
          dark: '#0a5f4e',
        },
        accent: '#f59e0b',
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
