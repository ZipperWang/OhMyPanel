export type TerminalActionId =
  | 'new-session'
  | 'duplicate-session'
  | 'close-session'
  | 'close-other-sessions'
  | 'next-session'
  | 'previous-session'
  | 'reconnect'
  | 'search'
  | 'clear-screen'
  | 'clear-scrollback'
  | 'copy'
  | 'paste'
  | 'font-increase'
  | 'font-decrease'
  | 'font-reset'
  | 'fullscreen'
  | 'connection-settings'
  | 'connection-details'

export interface TerminalAction {
  id: TerminalActionId
  label: string
  shortcut?: string
  keywords?: string[]
  disabled?: boolean
  restoreTerminalFocus?: boolean
  run: () => void | Promise<void>
}

export interface PasteGuardResult {
  kind: 'multiline' | 'large' | null
  lineCount: number
}

export function filterTerminalActions(actions: TerminalAction[], query: string): TerminalAction[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return actions
  const compact = normalized.replace(/\s+/g, '')
  return actions
    .map((action, index) => {
      const haystack = [action.label, action.id, ...(action.keywords ?? [])].join(' ').toLocaleLowerCase()
      const direct = haystack.indexOf(normalized)
      let cursor = 0
      let fuzzyScore = 0
      for (const character of compact) {
        const found = haystack.indexOf(character, cursor)
        if (found < 0) {
          fuzzyScore = Number.POSITIVE_INFINITY
          break
        }
        fuzzyScore += found - cursor
        cursor = found + 1
      }
      return { action, index, score: direct >= 0 ? direct : fuzzyScore + 100 }
    })
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(item => item.action)
}

export function getPasteGuard(text: string, largeTextThreshold = 1000): PasteGuardResult {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lineCount = normalized.length === 0 ? 0 : normalized.split('\n').length
  if (lineCount > 1) return { kind: 'multiline', lineCount }
  if (text.length >= largeTextThreshold) return { kind: 'large', lineCount }
  return { kind: null, lineCount }
}

export function parseConnectionHost(hostKey: string): { host: string; port: number } {
  const separator = hostKey.lastIndexOf('_')
  if (separator < 0) return { host: hostKey, port: 22 }
  const port = Number(hostKey.slice(separator + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { host: hostKey, port: 22 }
  return { host: hostKey.slice(0, separator), port }
}
