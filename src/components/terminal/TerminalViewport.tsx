import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { useTranslation } from 'react-i18next'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './Terminal.css'
import TerminalSearchBox from './TerminalSearchBox'
import TerminalCommandPalette from './TerminalCommandPalette'
import TerminalContextMenu, { type TerminalContextMenuItem } from './TerminalContextMenu'
import TerminalConnectionOverlay from './TerminalConnectionOverlay'
import { getPasteGuard, type TerminalAction } from './terminalActions'
import { subscribeTerminalOutput } from './terminalOutputBroker'
import { ompTerminalTheme, terminalCssVariables, terminalSearchDecorations } from './terminalTheme'
import type { TerminalConnectionState, TerminalDimensions } from './types'

interface TerminalViewportProps {
  sessionId: string | null
  isActive?: boolean
  connectionState?: TerminalConnectionState
  connectionLabel?: string
  endpoint?: string
  onReconnect?: () => void
  onCancelReconnect?: () => void
  onCloseSession?: () => void
  onNewSession?: () => void
  onDuplicateSession?: () => void
  onCloseOtherSessions?: () => void
  onNextSession?: () => void
  onPreviousSession?: () => void
  onOpenConnectionSettings?: () => void
  onDimensionsChange?: (dimensions: TerminalDimensions) => void
  onBackgroundOutput?: () => void
}

export interface TerminalHandle {
  sendCommand: (command: string) => void
  clear: () => void
  clearScreen: () => void
  clearScrollback: () => void
  focus: () => void
  openSearch: () => void
  openCommandPalette: () => void
  copySelection: () => Promise<void>
  pasteFromClipboard: () => Promise<void>
  toggleFullscreen: () => Promise<void>
  getDimensions: () => TerminalDimensions | null
}

interface PendingPaste {
  text: string
  kind: 'multiline' | 'large'
  lineCount: number
}

interface ContextMenuPosition {
  x: number
  y: number
}

const DEFAULT_CONNECTION_STATE: TerminalConnectionState = { kind: 'connected' }
const DEFAULT_FONT_SIZE = 14

function openWebLink(uri: string): void {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    void openExternal(url.href).catch(() => {})
  } catch {
    return
  }
}

export default forwardRef<TerminalHandle, TerminalViewportProps>(function TerminalViewport({
  sessionId,
  isActive = false,
  connectionState = DEFAULT_CONNECTION_STATE,
  connectionLabel = '',
  endpoint = '',
  onReconnect,
  onCancelReconnect,
  onCloseSession,
  onNewSession,
  onDuplicateSession,
  onCloseOtherSessions,
  onNextSession,
  onPreviousSession,
  onOpenConnectionSettings,
  onDimensionsChange,
  onBackgroundOutput,
}, ref) {
  const { t } = useTranslation()
  const windowRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const sidRef = useRef(sessionId)
  const activeRef = useRef(isActive)
  const connectionKindRef = useRef(connectionState.kind)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousConnectionKindRef = useRef(connectionState.kind)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchRegex, setSearchRegex] = useState(false)
  const [searchResult, setSearchResult] = useState({ resultIndex: -1, resultCount: 0 })
  const [invalidRegex, setInvalidRegex] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectionAvailable, setSelectionAvailable] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [restored, setRestored] = useState(false)
  const [notice, setNotice] = useState('')

  sidRef.current = sessionId
  activeRef.current = isActive
  connectionKindRef.current = connectionState.kind

  const callbackRef = useRef({
    onReconnect,
    onCancelReconnect,
    onCloseSession,
    onNewSession,
    onDuplicateSession,
    onCloseOtherSessions,
    onNextSession,
    onPreviousSession,
    onOpenConnectionSettings,
    onDimensionsChange,
    onBackgroundOutput,
  })
  callbackRef.current = {
    onReconnect,
    onCancelReconnect,
    onCloseSession,
    onNewSession,
    onDuplicateSession,
    onCloseOtherSessions,
    onNextSession,
    onPreviousSession,
    onOpenConnectionSettings,
    onDimensionsChange,
    onBackgroundOutput,
  }

  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setNotice(message)
    noticeTimerRef.current = setTimeout(() => setNotice(''), 2400)
  }, [])

  const syncPtySize = useCallback((immediate = false) => {
    const term = termRef.current
    if (!term) return
    const dimensions = { cols: term.cols, rows: term.rows }
    callbackRef.current.onDimensionsChange?.(dimensions)
    const send = () => {
      resizeTimerRef.current = null
      const currentTerm = termRef.current
      const sid = sidRef.current
      if (!currentTerm || !sid) return
      invoke('ssh_resize', { sessionId: sid, cols: currentTerm.cols, rows: currentTerm.rows }).catch(() => {})
    }
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    if (immediate) send()
    else resizeTimerRef.current = setTimeout(send, 80)
  }, [])

  const fitTerminal = useCallback((forceSync = false) => {
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null
      const host = hostRef.current
      if (!activeRef.current || !host || host.clientWidth < 2 || host.clientHeight < 2) return
      fitRef.current?.fit()
      if (forceSync) syncPtySize(true)
    })
  }, [syncPtySize])

  const focusTerminal = useCallback(() => {
    if (activeRef.current) termRef.current?.focus()
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setInvalidRegex(false)
    setSearchResult({ resultIndex: -1, resultCount: 0 })
    searchAddonRef.current?.clearDecorations()
    termRef.current?.clearSelection()
    requestAnimationFrame(focusTerminal)
  }, [focusTerminal])

  const openSearch = useCallback(() => {
    setPaletteOpen(false)
    setContextMenu(null)
    setDetailsOpen(false)
    setSearchOpen(true)
  }, [])

  const openCommandPalette = useCallback(() => {
    setSearchOpen(false)
    setInvalidRegex(false)
    setSearchResult({ resultIndex: -1, resultCount: 0 })
    searchAddonRef.current?.clearDecorations()
    termRef.current?.clearSelection()
    setContextMenu(null)
    setDetailsOpen(false)
    setPaletteOpen(true)
  }, [])

  const closeCommandPalette = useCallback((restoreTerminalFocus = true) => {
    setPaletteOpen(false)
    if (restoreTerminalFocus) requestAnimationFrame(focusTerminal)
  }, [focusTerminal])

  const copySelection = useCallback(async () => {
    const term = termRef.current
    if (!term?.hasSelection()) return
    try {
      await navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } catch {
      showNotice(t('terminal.paste.clipboardUnavailable'))
    } finally {
      focusTerminal()
    }
  }, [focusTerminal, showNotice, t])

  const pasteText = useCallback((text: string) => {
    if (!text || !sidRef.current || connectionKindRef.current !== 'connected') return
    const guard = getPasteGuard(text)
    if (guard.kind) {
      setPendingPaste({ text, kind: guard.kind, lineCount: guard.lineCount })
      return
    }
    termRef.current?.paste(text)
    focusTerminal()
  }, [focusTerminal])

  const pasteTextRef = useRef(pasteText)
  pasteTextRef.current = pasteText

  const pasteFromClipboard = useCallback(async () => {
    try {
      pasteText(await navigator.clipboard.readText())
    } catch {
      showNotice(t('terminal.paste.clipboardUnavailable'))
    }
  }, [pasteText, showNotice, t])

  const clearScreen = useCallback(() => {
    termRef.current?.input('\x0c', true)
    focusTerminal()
  }, [focusTerminal])

  const clearScrollback = useCallback(() => {
    termRef.current?.write('\x1b[3J')
    focusTerminal()
  }, [focusTerminal])

  const changeFontSize = useCallback((mode: 'increase' | 'decrease' | 'reset') => {
    const term = termRef.current
    if (!term) return
    const current = Number(term.options.fontSize || DEFAULT_FONT_SIZE)
    term.options.fontSize = mode === 'reset' ? DEFAULT_FONT_SIZE : Math.min(24, Math.max(10, current + (mode === 'increase' ? 1 : -1)))
    fitTerminal(true)
  }, [fitTerminal])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === windowRef.current) await document.exitFullscreen()
      else await windowRef.current?.requestFullscreen()
    } catch {
      showNotice(t('terminal.fullscreenUnavailable'))
    }
  }, [showNotice, t])

  const closeTransientUi = useCallback(() => {
    if (pendingPaste) {
      setPendingPaste(null)
      focusTerminal()
      return true
    }
    if (detailsOpen) {
      setDetailsOpen(false)
      focusTerminal()
      return true
    }
    if (paletteOpen) {
      closeCommandPalette()
      return true
    }
    if (searchOpen) {
      closeSearch()
      return true
    }
    if (contextMenu) {
      setContextMenu(null)
      focusTerminal()
      return true
    }
    return false
  }, [closeCommandPalette, closeSearch, contextMenu, detailsOpen, focusTerminal, paletteOpen, pendingPaste, searchOpen])

  const handleShortcut = useCallback((event: KeyboardEvent) => {
    if (event.type !== 'keydown') return false
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLocaleLowerCase()
    const consume = (action: () => void | Promise<void>) => {
      event.preventDefault()
      event.stopPropagation()
      void action()
      return true
    }
    if (event.key === 'Escape' && closeTransientUi()) return consume(() => {})
    if (pendingPaste || detailsOpen || paletteOpen || searchOpen || contextMenu) return consume(() => {})
    if (!modifier) {
      if (event.altKey && event.key === 'Enter') return consume(toggleFullscreen)
      return false
    }
    if (event.altKey) return false
    if (key === 'c' && !event.shiftKey) return false
    if (key === 'c' && event.shiftKey) return consume(copySelection)
    if (key === 'v' && event.shiftKey) return consume(pasteFromClipboard)
    if (key === 'f' && event.shiftKey) return consume(openSearch)
    if (key === 'p' && event.shiftKey) return consume(openCommandPalette)
    if (key === 't' && event.shiftKey && callbackRef.current.onNewSession) return consume(callbackRef.current.onNewSession)
    if (key === 'w' && event.shiftKey && callbackRef.current.onCloseSession) return consume(callbackRef.current.onCloseSession)
    if (event.key === 'Tab' && event.shiftKey && callbackRef.current.onPreviousSession) return consume(callbackRef.current.onPreviousSession)
    if (event.key === 'Tab' && callbackRef.current.onNextSession) return consume(callbackRef.current.onNextSession)
    if (event.key === '+' || event.key === '=') return consume(() => changeFontSize('increase'))
    if (event.key === '-') return consume(() => changeFontSize('decrease'))
    if (event.key === '0') return consume(() => changeFontSize('reset'))
    return false
  }, [changeFontSize, closeTransientUi, contextMenu, copySelection, detailsOpen, openCommandPalette, openSearch, paletteOpen, pasteFromClipboard, pendingPaste, searchOpen, toggleFullscreen])

  const shortcutRef = useRef(handleShortcut)
  shortcutRef.current = handleShortcut

  useEffect(() => {
    if (!hostRef.current) return
    const term = new XTerminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: '"Cascadia Mono", "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.24,
      letterSpacing: 0,
      scrollback: 10000,
      scrollOnUserInput: true,
      overviewRuler: { width: 6 },
      rightClickSelectsWord: false,
      theme: ompTerminalTheme,
      allowTransparency: false,
      linkHandler: {
        activate: (_event, uri) => openWebLink(uri),
      },
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon({ highlightLimit: 1000 })
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(new WebLinksAddon((_event, uri) => openWebLink(uri)))
    term.open(hostRef.current)
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase() === 'c' && term.hasSelection()) return false
      return !shortcutRef.current(event)
    })

    termRef.current = term
    fitRef.current = fitAddon
    searchAddonRef.current = searchAddon

    const inputDisposable = term.onData(data => {
      const sid = sidRef.current
      if (sid && connectionKindRef.current === 'connected') invoke('ssh_input', { sessionId: sid, data }).catch(() => {})
    })
    const resizeDisposable = term.onResize(() => syncPtySize(false))
    const selectionDisposable = term.onSelectionChange(() => setSelectionAvailable(term.hasSelection()))
    const resultDisposable = searchAddon.onDidChangeResults(result => setSearchResult(result))
    const host = hostRef.current
    const pasteHandler = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain')
      if (text === undefined) return
      event.preventDefault()
      event.stopPropagation()
      pasteTextRef.current(text)
    }
    host.addEventListener('paste', pasteHandler, true)
    const resizeObserver = new ResizeObserver(() => fitTerminal(false))
    resizeObserver.observe(host)
    fitTerminal(true)

    return () => {
      resizeObserver.disconnect()
      host.removeEventListener('paste', pasteHandler, true)
      inputDisposable.dispose()
      resizeDisposable.dispose()
      selectionDisposable.dispose()
      resultDisposable.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchAddonRef.current = null
    }
  }, [fitTerminal, syncPtySize])

  useEffect(() => {
    if (!sessionId) return
    return subscribeTerminalOutput(sessionId, data => {
      const term = termRef.current
      if (!term) return
      term.write(data)
      if (!activeRef.current) callbackRef.current.onBackgroundOutput?.()
    })
  }, [sessionId])

  useEffect(() => {
    if (!isActive) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const terminalWindow = windowRef.current
      if (!target || !terminalWindow?.contains(target)) return
      if (target.closest('.terminal-search-box, .terminal-command-palette, .terminal-context-menu, .terminal-modal, button, input, textarea, select, [contenteditable="true"]')) return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase() === 'c' && termRef.current?.hasSelection()) return
      shortcutRef.current(event)
    }
    window.addEventListener('keydown', handler, true)
    fitTerminal(true)
    requestAnimationFrame(focusTerminal)
    return () => window.removeEventListener('keydown', handler, true)
  }, [fitTerminal, focusTerminal, isActive])

  useEffect(() => {
    if (isActive) fitTerminal(true)
  }, [fitTerminal, isActive, sessionId])

  useEffect(() => {
    if (!searchOpen) return
    const addon = searchAddonRef.current
    if (!addon || !searchQuery) {
      addon?.clearDecorations()
      setSearchResult({ resultIndex: -1, resultCount: 0 })
      setInvalidRegex(false)
      return
    }
    try {
      setInvalidRegex(false)
      addon.findNext(searchQuery, {
        caseSensitive: searchCaseSensitive,
        regex: searchRegex,
        incremental: true,
        decorations: terminalSearchDecorations,
      })
    } catch {
      addon.clearDecorations()
      setInvalidRegex(true)
      setSearchResult({ resultIndex: -1, resultCount: 0 })
    }
  }, [searchCaseSensitive, searchOpen, searchQuery, searchRegex])

  useEffect(() => {
    const previous = previousConnectionKindRef.current
    previousConnectionKindRef.current = connectionState.kind
    if (connectionState.kind !== 'connected' || (previous !== 'reconnecting' && previous !== 'connecting')) return
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current)
    setRestored(true)
    restoreTimerRef.current = setTimeout(() => setRestored(false), 2000)
  }, [connectionState.kind])

  useEffect(() => {
    const handler = () => {
      const active = document.fullscreenElement === windowRef.current
      setIsFullscreen(active)
      if (activeRef.current) fitTerminal(true)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [fitTerminal])

  useEffect(() => () => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current)
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
  }, [])

  const runSearch = useCallback((direction: 'next' | 'previous') => {
    if (!searchQuery || invalidRegex) return
    try {
      const options = {
        caseSensitive: searchCaseSensitive,
        regex: searchRegex,
        decorations: terminalSearchDecorations,
      }
      if (direction === 'next') searchAddonRef.current?.findNext(searchQuery, options)
      else searchAddonRef.current?.findPrevious(searchQuery, options)
    } catch {
      setInvalidRegex(true)
    }
  }, [invalidRegex, searchCaseSensitive, searchQuery, searchRegex])

  const actions = useMemo<TerminalAction[]>(() => [
    { id: 'new-session', label: t('terminal.actions.newSession'), shortcut: 'Ctrl+Shift+T', disabled: !onNewSession, restoreTerminalFocus: false, run: () => onNewSession?.() },
    { id: 'duplicate-session', label: t('terminal.actions.duplicateCurrent'), disabled: !onDuplicateSession, restoreTerminalFocus: false, run: () => onDuplicateSession?.() },
    { id: 'reconnect', label: t('terminal.actions.reconnectCurrent'), disabled: !onReconnect || connectionState.kind === 'connecting' || connectionState.kind === 'reconnecting', run: () => onReconnect?.() },
    { id: 'close-session', label: t('terminal.actions.closeCurrent'), shortcut: 'Ctrl+Shift+W', disabled: !onCloseSession, run: () => onCloseSession?.() },
    { id: 'close-other-sessions', label: t('terminal.actions.closeOthers'), disabled: !onCloseOtherSessions, run: () => onCloseOtherSessions?.() },
    { id: 'next-session', label: t('terminal.actions.nextSession'), shortcut: 'Ctrl+Tab', disabled: !onNextSession, run: () => onNextSession?.() },
    { id: 'previous-session', label: t('terminal.actions.previousSession'), shortcut: 'Ctrl+Shift+Tab', disabled: !onPreviousSession, run: () => onPreviousSession?.() },
    { id: 'search', label: t('terminal.actions.searchOutput'), shortcut: 'Ctrl+Shift+F', restoreTerminalFocus: false, run: openSearch },
    { id: 'clear-screen', label: t('terminal.actions.clearScreen'), shortcut: 'Ctrl+L', disabled: !sessionId || connectionState.kind !== 'connected', run: clearScreen },
    { id: 'clear-scrollback', label: t('terminal.actions.clearScrollback'), run: clearScrollback },
    { id: 'copy', label: t('terminal.actions.copySelection'), shortcut: 'Ctrl+Shift+C', disabled: !selectionAvailable, restoreTerminalFocus: false, run: copySelection },
    { id: 'paste', label: t('terminal.actions.pasteClipboard'), shortcut: 'Ctrl+Shift+V', disabled: !sessionId || connectionState.kind !== 'connected', restoreTerminalFocus: false, run: pasteFromClipboard },
    { id: 'font-increase', label: t('terminal.actions.fontIncrease'), shortcut: 'Ctrl++', run: () => changeFontSize('increase') },
    { id: 'font-decrease', label: t('terminal.actions.fontDecrease'), shortcut: 'Ctrl+-', run: () => changeFontSize('decrease') },
    { id: 'font-reset', label: t('terminal.actions.fontReset'), shortcut: 'Ctrl+0', run: () => changeFontSize('reset') },
    { id: 'fullscreen', label: isFullscreen ? t('terminal.actions.exitFullscreen') : t('terminal.actions.enterFullscreen'), shortcut: 'Alt+Enter', run: toggleFullscreen },
    { id: 'connection-settings', label: t('terminal.actions.connectionSettings'), disabled: !onOpenConnectionSettings, restoreTerminalFocus: false, run: () => onOpenConnectionSettings?.() },
    { id: 'connection-details', label: t('terminal.actions.connectionDetails'), restoreTerminalFocus: false, run: () => setDetailsOpen(true) },
  ], [changeFontSize, clearScreen, clearScrollback, connectionState.kind, copySelection, isFullscreen, onCloseOtherSessions, onCloseSession, onDuplicateSession, onNewSession, onNextSession, onOpenConnectionSettings, onPreviousSession, onReconnect, openSearch, pasteFromClipboard, selectionAvailable, sessionId, t, toggleFullscreen])

  const contextItems = useMemo<TerminalContextMenuItem[]>(() => [
    { id: 'copy', label: t('common.copy'), disabled: !selectionAvailable, onSelect: copySelection },
    { id: 'paste', label: t('common.paste'), disabled: !sessionId || connectionState.kind !== 'connected', onSelect: pasteFromClipboard },
    { id: 'select-all', label: t('terminal.actions.selectAll'), onSelect: () => { termRef.current?.selectAll(); focusTerminal() } },
    { id: 'search', label: t('common.search'), onSelect: openSearch },
    { id: 'separator-one', separator: true },
    { id: 'clear-screen', label: t('terminal.actions.clearScreen'), disabled: !sessionId || connectionState.kind !== 'connected', onSelect: clearScreen },
    { id: 'clear-scrollback', label: t('terminal.actions.clearScrollback'), onSelect: clearScrollback },
    { id: 'separator-two', separator: true },
    { id: 'reconnect', label: t('terminal.actions.reconnectCurrent'), disabled: !onReconnect || connectionState.kind === 'connecting' || connectionState.kind === 'reconnecting', onSelect: () => onReconnect?.() },
    { id: 'details', label: t('terminal.actions.connectionDetails'), onSelect: () => setDetailsOpen(true) },
  ], [clearScreen, clearScrollback, connectionState.kind, copySelection, focusTerminal, onReconnect, openSearch, pasteFromClipboard, selectionAvailable, sessionId, t])

  useImperativeHandle(ref, () => ({
    sendCommand: command => {
      const sid = sidRef.current
      if (sid) invoke('ssh_input', { sessionId: sid, data: command + '\r' }).catch(() => {})
    },
    clear: clearScrollback,
    clearScreen,
    clearScrollback,
    focus: focusTerminal,
    openSearch,
    openCommandPalette,
    copySelection,
    pasteFromClipboard,
    toggleFullscreen,
    getDimensions: () => termRef.current ? { cols: termRef.current.cols, rows: termRef.current.rows } : null,
  }), [clearScreen, clearScrollback, copySelection, focusTerminal, openCommandPalette, openSearch, pasteFromClipboard, toggleFullscreen])

  const target = connectionLabel || endpoint || 'SSH'
  const dimensions = termRef.current ? { cols: termRef.current.cols, rows: termRef.current.rows } : null

  return (
    <div
      ref={windowRef}
      className="terminal-window"
      style={terminalCssVariables}
      onMouseDown={() => setContextMenu(null)}
      onMouseDownCapture={event => {
        if (event.button === 2 && hostRef.current?.contains(event.target as Node)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onContextMenuCapture={event => {
        if (!hostRef.current?.contains(event.target as Node)) return
        event.preventDefault()
        event.stopPropagation()
        const viewport = viewportRef.current
        if (!viewport) return
        const rect = viewport.getBoundingClientRect()
        setContextMenu({
          x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 226)),
          y: Math.max(8, Math.min(event.clientY - rect.top, rect.height - 330)),
        })
      }}
    >
      <div ref={viewportRef} className="terminal-viewport">
        <div className="terminal-host-padding">
          <div ref={hostRef} className="terminal-host" />
        </div>
        {searchOpen && (
          <TerminalSearchBox
            query={searchQuery}
            caseSensitive={searchCaseSensitive}
            regex={searchRegex}
            current={searchResult.resultCount > 0 ? searchResult.resultIndex + 1 : 0}
            total={searchResult.resultCount}
            invalidRegex={invalidRegex}
            onQueryChange={setSearchQuery}
            onToggleCaseSensitive={() => setSearchCaseSensitive(value => !value)}
            onToggleRegex={() => setSearchRegex(value => !value)}
            onPrevious={() => runSearch('previous')}
            onNext={() => runSearch('next')}
            onClose={closeSearch}
          />
        )}
        {paletteOpen && <TerminalCommandPalette actions={actions} onClose={closeCommandPalette} />}
        {contextMenu && <TerminalContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={(restoreTerminalFocus = true) => { setContextMenu(null); if (restoreTerminalFocus) requestAnimationFrame(focusTerminal) }} />}
        <TerminalConnectionOverlay
          state={connectionState}
          target={target}
          onReconnect={onReconnect}
          onCancelReconnect={onCancelReconnect}
          onCloseSession={onCloseSession}
          onEditConnection={onOpenConnectionSettings}
        />
        {restored && <div className="terminal-inline-notice success">{t('terminal.status.restored')}</div>}
        {notice && <div className="terminal-inline-notice">{notice}</div>}
        {pendingPaste && (
          <div className="terminal-modal-backdrop" onMouseDown={() => { setPendingPaste(null); focusTerminal() }}>
            <div
              className="terminal-modal"
              role="dialog"
              aria-modal="true"
              onMouseDown={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                setPendingPaste(null)
                focusTerminal()
              }}
            >
              <strong>{pendingPaste.kind === 'multiline'
                ? t('terminal.paste.multilineTitle', { count: pendingPaste.lineCount, target })
                : t('terminal.paste.largeTitle', { target })}</strong>
              <span>{t('terminal.paste.warning')}</span>
              <div>
                <button autoFocus onClick={() => { setPendingPaste(null); focusTerminal() }}>{t('common.cancel')}</button>
                <button className="primary" onClick={() => {
                  termRef.current?.paste(pendingPaste.text)
                  setPendingPaste(null)
                  focusTerminal()
                }}>{t('common.paste')}</button>
              </div>
            </div>
          </div>
        )}
        {detailsOpen && (
          <div className="terminal-modal-backdrop" onMouseDown={() => { setDetailsOpen(false); focusTerminal() }}>
            <div
              className="terminal-modal terminal-details"
              role="dialog"
              aria-modal="true"
              onMouseDown={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                setDetailsOpen(false)
                focusTerminal()
              }}
            >
              <strong>{t('terminal.actions.connectionDetails')}</strong>
              <dl>
                <dt>{t('terminal.details.protocol')}</dt><dd>SSH</dd>
                <dt>{t('terminal.details.endpoint')}</dt><dd dir="ltr">{endpoint || t('terminal.details.unavailable')}</dd>
                <dt>{t('terminal.details.terminalSize')}</dt><dd dir="ltr">{dimensions ? `${dimensions.cols} × ${dimensions.rows}` : t('terminal.details.unavailable')}</dd>
                <dt>{t('terminal.details.encoding')}</dt><dd>UTF-8</dd>
              </dl>
              <button autoFocus className="primary" onClick={() => { setDetailsOpen(false); focusTerminal() }}>{t('common.close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
