/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"Cascadia Code"', 'Consolas', 'monospace'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        'canvas': 'rgb(var(--canvas) / <alpha-value>)',
        'sidebar': 'rgb(var(--sidebar) / <alpha-value>)',
        'surface': 'rgb(var(--surface) / <alpha-value>)',
        'muted': 'rgb(var(--muted) / <alpha-value>)',
        'hover': 'rgb(var(--hover) / <alpha-value>)',
        'subtle': 'rgb(var(--text-muted) / <alpha-value>)',
        'primary': 'rgb(var(--primary) / <alpha-value>)',
        'secondary': 'rgb(var(--secondary) / <alpha-value>)',
        'line': 'rgb(var(--line) / <alpha-value>)',
        'control-line': 'rgb(var(--control-line) / <alpha-value>)',
        'focus': 'rgb(var(--focus) / <alpha-value>)',
        'selection': 'rgb(var(--selection) / <alpha-value>)',
        'overlay': 'rgb(var(--overlay) / <alpha-value>)',
        'action': 'rgb(var(--action) / <alpha-value>)',
        'action-hover': 'rgb(var(--action-hover) / <alpha-value>)',
        'on-action': 'rgb(var(--on-action) / <alpha-value>)',
        ink: Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950].map(n => [n, 'rgb(var(--legacy-ink-' + n + ') / <alpha-value>)'])),
        jade: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(n => [n, 'rgb(var(--jade-' + (n <= 200 ? 'surface' : n <= 400 ? 'border' : 'text') + ') / <alpha-value>)'])),
        amber: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(n => [n, 'rgb(var(--amber-' + (n <= 200 ? 'surface' : n <= 400 ? 'border' : 'text') + ') / <alpha-value>)'])),
        rose: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(n => [n, 'rgb(var(--rose-' + (n <= 200 ? 'surface' : n <= 400 ? 'border' : 'text') + ') / <alpha-value>)'])),
        blue: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(n => [n, 'rgb(var(--blue-' + (n <= 200 ? 'surface' : n <= 400 ? 'border' : 'text') + ') / <alpha-value>)'])),
        sky: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(n => [n, 'rgb(var(--sky-' + (n <= 200 ? 'surface' : n <= 400 ? 'border' : 'text') + ') / <alpha-value>)'])),
        orange: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(n => [n, 'rgb(var(--orange-' + (n <= 200 ? 'surface' : n <= 400 ? 'border' : 'text') + ') / <alpha-value>)'])),
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'soft': 'var(--shadow-soft)',
        'card': 'var(--shadow-soft)',
        'float': 'var(--shadow-float)',
      },
    },
  },
  plugins: [],
}
