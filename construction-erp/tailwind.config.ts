import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F7F8FA', surface: '#FFFFFF', ink: '#17212F', muted: '#526174', line: '#D9DFE7', accent: '#244B78',
        'accent-ink': '#FFFFFF', 'accent-soft': '#E8EEF6', ok: '#1F6B3B', 'ok-soft': '#E6F3EA', warn: '#8A5A00', 'warn-soft': '#FFF3D6',
        bad: '#A32121', 'bad-soft': '#FBE9E9', info: '#244B78',
      },
      fontFamily: { sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      borderRadius: { DEFAULT: '8px', lg: '12px' },
      spacing: { 18: '4.5rem' },
    },
  },
} satisfies Config;
