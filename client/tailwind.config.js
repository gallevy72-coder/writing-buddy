/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        buddy: {
          blue: '#4A90D9',
          green: '#4CAF50',
          yellow: '#FFD54F',
          orange: '#FF9800',
          purple: '#AB47BC',
          bg: '#F0F7FF',
        },
      },
      fontFamily: {
        sans: ['Rubik', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
