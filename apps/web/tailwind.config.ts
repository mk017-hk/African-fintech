import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0b0d12',
        surface:  '#11141b',
        border:   '#1d2230',
        text:     '#e7eaf0',
        muted:    '#8a93a6',
        accent:   '#22c55e',
        warning:  '#f59e0b',
        danger:   '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
