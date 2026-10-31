import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        trading: {
          primary: '#FFCC00',
          positive: '#22C55E',
          negative: '#EF4444',
          line: '#3B82F6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(9,9,11,.06), 0 8px 24px -12px rgba(9,9,11,.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
