import type { ITheme } from '@xterm/xterm'

export type ThemeName = 'dark' | 'light'

export const terminalThemes: Record<ThemeName, ITheme> = {
  dark: {
    background: '#0b0d12',
    foreground: '#d6dae3',
    cursor: '#7aa2f7',
    cursorAccent: '#0b0d12',
    selectionBackground: '#2b3a55',
    black: '#1b1e27',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6'
  },
  // GitHub Light-flavored
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#0969da',
    cursorAccent: '#ffffff',
    selectionBackground: '#b6d0f5',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0550ae',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781'
  }
}
