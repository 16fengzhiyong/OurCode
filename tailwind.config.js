/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Glass 2026 design tokens (mapped to CSS variables in global.css)
        nova: {
          bg: 'var(--bg, #f6f7fb)',
          surface: 'var(--surface, #ffffff)',
          card: 'var(--card, rgba(255,255,255,0.75))',
          sidebar: 'var(--sidebar, #ffffff)',
          editor: 'var(--editor-bg, #ffffff)',
          'code-bg': 'var(--surface, #ffffff)',
          terminal: '#0f1420',
          'ai-panel': 'var(--ai-bg, #ffffff)',
          'ai-header': 'var(--ai-surface, rgba(255,255,255,0.6))',
          tabs: 'var(--bg-tabs, rgba(255,255,255,0.6))',
          'tab-active': 'var(--bg-tab-active, #ffffff)',
          border: 'var(--border, rgba(15,23,42,0.08))',
          'border-light': 'rgba(255,255,255,0.6)',
          'border-dark': 'var(--ai-border, rgba(15,23,42,0.1))',
          hover: 'var(--hover, rgba(15,23,42,0.06))',
          'input-bg': 'var(--input-bg, rgba(255,255,255,0.6))',
          'bubble-user': 'var(--bubble-user, #e8f0ff)',
          'bubble-ai': 'var(--ai-surface, rgba(255,255,255,0.6))',
          'badge-bg': 'rgba(0,88,188,0.1)',
          'text-primary': 'var(--text-primary, #0f172a)',
          'text-secondary': 'var(--text-secondary, #334155)',
          'text-muted': 'var(--text-muted, #64748b)',
          accent: 'var(--accent, #0058bc)',
        },
        accent: {
          blue: 'var(--accent, #0058bc)',
          purple: 'var(--accent-purple, #7c3aed)',
          'btn-primary': 'var(--accent, #0058bc)',
          'btn-send': 'var(--accent, #0058bc)',
        },
        // Stitch Glass Light tokens — glassmorphism surfaces & hairline borders
        glass: {
          border: 'rgba(255,255,255,0.6)',
          bg: 'rgba(255,255,255,0.4)',
        },
        text: {
          primary: 'var(--text-primary, #0f172a)',
          secondary: 'var(--text-secondary, #334155)',
          muted: 'var(--text-muted, #64748b)',
          dim: 'var(--text-disabled, #cbd5e1)',
        },
        syntax: {
          keyword: '#C184C6',
          function: '#D1D6AE',
          string: '#C48081',
          comment: '#6F9B60',
          default: '#BBBEBF',
          line: '#5C6370',
        },
        // Keep legacy for compatibility
        editor: {
          bg: '#0f1420',
          'bg-light': '#ffffff',
          fg: '#BBBEBF',
          'fg-light': '#202020',
          line: '#0f1420',
          'line-light': '#f8fafc',
          selection: '#276782',
          'selection-light': '#0058bc',
          comment: '#6F9B60',
          keyword: '#C184C6',
          string: '#C48081',
        },
        sidebar: {
          bg: '#151a26',
          'bg-light': '#ffffff',
          hover: '#1b2130',
          'hover-light': 'rgba(15,23,42,0.06)',
        },
        chat: {
          bg: '#151a26',
          'bg-light': '#ffffff',
          user: '#0058bc',
          assistant: '#0058bc',
          input: '#1b2130',
          'input-light': 'rgba(255,255,255,0.6)',
        },
      },
      backgroundImage: {
        'gradient-blue-violet': 'linear-gradient(135deg, #0ea5e9, #6366f1, #a855f7)',
        'gradient-sunset-peach': 'linear-gradient(135deg, #f97316, #fb7185)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-dot': 'pulseDot 1.5s infinite',
        'logo-pulse': 'logoPulse 2.5s ease-in-out infinite',
        'think-bounce': 'thinkBounce 1.2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        logoPulse: {
          '0%, 100%': { boxShadow: '0 0 6px #0058bc88' },
          '50%': { boxShadow: '0 0 14px #0ea5e9, 0 0 24px #0ea5e966' },
        },
        thinkBounce: {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-6px)', opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}
