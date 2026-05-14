/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'vscode-bg': 'var(--vscode-sideBar-background)',
        'vscode-fg': 'var(--vscode-sideBar-foreground)',
        'vscode-accent': 'var(--vscode-button-background)',
        'vscode-border': 'var(--vscode-sideBar-border)',
        'fuelix-purple': '#8b5cf6',
        'fuelix-blue': '#3b82f6',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
