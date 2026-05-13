/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
        display: ['"Fraunces"', 'serif'],
      },
      colors: {
        ink: {
          950: '#0d0c0b',
          900: '#1a1917',
          800: '#2c2a26',
          700: '#3d3a35',
          600: '#5a5650',
          500: '#7a756e',
          400: '#9e9890',
          300: '#c4bdb4',
          200: '#ddd8d0',
          100: '#eeebe6',
          50:  '#f7f5f2',
        },
        jade: {
          900: '#0a2e20',
          700: '#0f5c3a',
          500: '#18916a',
          400: '#22b584',
          300: '#5ccfa8',
          100: '#d0f4e8',
          50:  '#edfaf4',
        },
        amber: {
          900: '#2d1a00',
          700: '#7a4200',
          500: '#c96f00',
          400: '#f08c1a',
          300: '#f5b55a',
          100: '#fde8c0',
          50:  '#fff6e6',
        },
        rose: {
          700: '#8b1a2e',
          500: '#d4294a',
          400: '#e84e6a',
          100: '#fcd6de',
          50:  '#fef0f3',
        },
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(13,12,11,0.06), 0 1px 2px rgba(13,12,11,0.04)',
        'card': '0 4px 16px rgba(13,12,11,0.08), 0 1px 4px rgba(13,12,11,0.04)',
        'float': '0 8px 32px rgba(13,12,11,0.12), 0 2px 8px rgba(13,12,11,0.06)',
      },
    },
  },
  plugins: [],
}
