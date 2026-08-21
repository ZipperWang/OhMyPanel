import type { CSSProperties } from 'react'
import type { ITheme } from '@xterm/xterm'
import type { ISearchOptions } from '@xterm/addon-search'

export const terminalTokens = {
  canvas: '#0C0F14',
  tabBar: '#181B20',
  tabHover: '#24282F',
  border: '#2B3038',
  text: '#CCCCCC',
  muted: '#8B949E',
  brandBlue: '#2563EB',
  brandCyan: '#16B8C4',
  connected: '#3FB950',
  connecting: '#D29922',
  disconnected: '#F85149',
  notification: '#58A6FF',
} as const

export const ompTerminalTheme: ITheme = {
  background: terminalTokens.canvas,
  foreground: terminalTokens.text,
  cursor: '#F2F2F2',
  cursorAccent: terminalTokens.canvas,
  selectionBackground: '#264F78',
  selectionForeground: '#FFFFFF',
  black: '#0C0C0C',
  red: '#C50F1F',
  green: '#13A10E',
  yellow: '#C19C00',
  blue: '#0037DA',
  magenta: '#881798',
  cyan: '#3A96DD',
  white: '#CCCCCC',
  brightBlack: '#767676',
  brightRed: '#E74856',
  brightGreen: '#16C60C',
  brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF',
  brightMagenta: '#B4009E',
  brightCyan: '#61D6D6',
  brightWhite: '#F2F2F2',
}

export const terminalCssVariables = {
  '--terminal-canvas': terminalTokens.canvas,
  '--terminal-tabbar': terminalTokens.tabBar,
  '--terminal-tab-hover': terminalTokens.tabHover,
  '--terminal-border': terminalTokens.border,
  '--terminal-text': terminalTokens.text,
  '--terminal-muted': terminalTokens.muted,
  '--terminal-brand-blue': terminalTokens.brandBlue,
  '--terminal-brand-cyan': terminalTokens.brandCyan,
  '--terminal-connected': terminalTokens.connected,
  '--terminal-connecting': terminalTokens.connecting,
  '--terminal-disconnected': terminalTokens.disconnected,
  '--terminal-notification': terminalTokens.notification,
} as CSSProperties

export const terminalSearchDecorations: NonNullable<ISearchOptions['decorations']> = {
  matchBackground: '#5A4300',
  matchBorder: '#C19C00',
  matchOverviewRuler: '#C19C00',
  activeMatchBackground: '#264F78',
  activeMatchBorder: '#61D6D6',
  activeMatchColorOverviewRuler: '#61D6D6',
}
