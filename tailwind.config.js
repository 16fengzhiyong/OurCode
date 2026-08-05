/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Nova Studio color scheme — VS Code Dark+ palette
        nova: {
          bg: 'var(--bg, #1e1e1e)',
          surface: 'var(--surface, #252526)',
          sidebar: 'var(--sidebar, #252526)',
          editor: 'var(--editor-bg, #1e1e1e)',
          'code-bg': 'rgba(0,0,0,0.4)',
          terminal: '#1e1e1e',
          'ai-panel': '#1a1a2e',
          'ai-header': '#16213e',
          border: 'var(--border, #454545)',
          'border-light': '#3d3d3d',
          'border-dark': '#0f3460',
          hover: 'var(--hover, #2a2d2e)',
          'input-bg': 'var(--input-bg, #3c3c3c)',
          'bubble-user': '#0f3460',
          'bubble-ai': '#16213e',
          'badge-bg': 'rgba(124,92,191,0.2)',
          'text-primary': 'var(--text-primary, #cccccc)',
          'text-secondary': 'var(--text-secondary, #cccccc)',
          'text-muted': 'var(--text-muted, #8d8d8d)',
          accent: 'var(--accent, #007acc)',
        },
        accent: {
          blue: 'var(--accent, #007acc)',
          purple: 'var(--accent-purple, #7c5cbf)',
          'btn-primary': '#007acc',
          'btn-send': '#533483',
        },
        text: {
          primary: 'var(--text-primary, #cccccc)',
          secondary: 'var(--text-secondary, #cccccc)',
          muted: 'var(--text-muted, #8d8d8d)',
          dim: '#5a5a5a',
        },
        syntax: {
          keyword: '#C678DD',
          function: '#61AFEF',
          string: '#98C379',
          comment: '#5C6370',
          default: '#D4D4D4',
          line: '#5C6370',
        },
        // Keep legacy for compatibility
        editor: {
          bg: '#1e1e1e',
          'bg-light': '#ffffff',
          fg: '#cccccc',
          'fg-light': '#333333',
          line: '#1e1e1e',
          'line-light': '#f5f5f5',
          selection: '#264f78',
          'selection-light': '#add6ff',
          comment: '#5C6370',
          keyword: '#C678DD',
          string: '#98C379',
        },
        sidebar: {
          bg: '#252526',
          'bg-light': '#f3f3f3',
          hover: '#2a2d2e',
          'hover-light': '#e8e8e8',
        },
        chat: {
          bg: '#1a1a2e',
          'bg-light': '#ffffff',
          user: '#007acc',
          assistant: '#7c5cbf',
          input: '#16213e',
          'input-light': '#f0f0f0',
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
          '0%, 100%': { boxShadow: '0 0 6px #7c5cbf88' },
          '50%': { boxShadow: '0 0 14px #7c5cbf, 0 0 24px #007acc66' },
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
