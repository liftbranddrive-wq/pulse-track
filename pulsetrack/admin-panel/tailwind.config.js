/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: '#F4F5F4',
        surface: '#FFFFFF',
        ink: '#0f172a',
        muted: '#64748b',
        line: '#e7e9e7',
        brand: '#14b8a6',
        ghost: '#f59e0b',
        idle: '#cbd5e1',
        breakC: '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', '"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)',
      },
      borderRadius: {
        xl2: '1rem',
      },
    },
  },
  plugins: [],
};
