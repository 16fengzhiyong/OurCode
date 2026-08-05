/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Windsurf 2026 design tokens (mapped to CSS variables in global.css)
        nova: {
          bg: 'var(--bg, #121314)',
          surface: 'var(--surface, #191a1b)',
          card: 'var(--card, #202122)',
          sidebar: 'var(--sidebar, #191a1b)',
          editor: 'var(--editor-bg, #121314)',
          'code-bg': 'var(--surface, #191a1b)',
          terminal: '#121314',
          'ai-panel': 'var(--ai-bg, #191a1b)',
          'ai-header': 'var(--ai-surface, #202122)',
          tabs: 'var(--bg-tabs, #191a1b)',
          'tab-active': 'var(--bg-tab-active, #121314)',
          border: 'var(--border, #2a2b2c)',
          'border-light': '#333536',
          'border-dark': 'var(--ai-border, #2a2b2c)',
          hover: 'var(--hover, #262728)',
          'input-bg': 'var(--input-bg, #191a1b)',
          'bubble-user': 'rgba(255,255,255,0.075)',
          'bubble-ai': 'var(--ai-surface, #202122)',
          'badge-bg': 'rgba(57,148,188,0.15)',
          'text-primary': 'var(--text-primary, #bfbfbf)',
          'text-secondary': 'var(--text-secondary, #bfbfbf)',
          'text-muted': 'var(--text-muted, #8c8c8c)',
          accent: 'var(--accent, #3994bc)',
        },
        accent: {
          blue: 'var(--accent, #3994bc)',
          purple: 'var(--accent-purple, #3994bc)',
          'btn-primary': 'var(--accent, #3994bc)',
          'btn-send': 'var(--accent, #3994bc)',
        },
        text: {
          primary: 'var(--text-primary, #bfbfbf)',
          secondary: 'var(--text-secondary, #bfbfbf)',
          muted: 'var(--text-muted, #8c8c8c)',
          dim: 'var(--text-disabled, #666666)',
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
          bg: '#121314',
          'bg-light': '#ffffff',
          fg: '#BBBEBF',
          'fg-light': '#202020',
          line: '#121314',
          'line-light': '#f5f5f5',
          selection: '#276782',
          'selection-light': '#0069cc',
          comment: '#6F9B60',
          keyword: '#C184C6',
          string: '#C48081',
        },
        sidebar: {
          bg: '#191a1b',
          'bg-light': '#fafafd',
          hover: '#262728',
          'hover-light': '#ececef',
        },
        chat: {
          bg: '#191a1b',
          'bg-light': '#fafafd',
          user: '#3994bc',
          assistant: '#3994bc',
          input: '#202122',
          'input-light': '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-dot': 'pulseDot 1.5s infinite',
        'logo-pulse': 'logoPulse 2.5s ease-in-out infinite',
        'think-bounce': 'thinkBounce 1.2s ease-in-out infinite',
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
        logoPulse: {
          '0%, 100%': { boxShadow: '0 0 6px #3994bc88' },
          '50%': { boxShadow: '0 0 14px #3994bc, 0 0 24px #3994bc66' },
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
