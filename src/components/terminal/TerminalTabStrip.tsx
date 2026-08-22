import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import TerminalTab from './TerminalTab'
import { terminalCssVariables } from './terminalTheme'
import type { TerminalSavedConnection, TerminalSessionTabModel } from './types'

interface TerminalTabStripProps {
  sessions: TerminalSessionTabModel[]
  activeId: string | null
  commandAvailable: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNewSession: () => void
  onConnect: (connection: TerminalSavedConnection) => void
  onOpenCommandPalette: () => void
  onReorder: (fromId: string, toId: string) => void
}

export default function TerminalTabStrip({ sessions, activeId, commandAvailable, onActivate, onClose, onNewSession, onConnect, onOpenCommandPalette, onReorder }: TerminalTabStripProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [savedConnections, setSavedConnections] = useState<TerminalSavedConnection[]>([])
  const [loading, setLoading] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeIndex = sessions.findIndex(session => session.id === activeId)

  const activateRelative = (offset: number) => {
    if (sessions.length < 2) return
    const index = activeIndex < 0 ? 0 : activeIndex
    onActivate(sessions[(index + offset + sessions.length) % sessions.length].id)
  }

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const toggleMenu = async () => {
    const next = !menuOpen
    setMenuOpen(next)
    if (!next) return
    setLoading(true)
    try {
      setSavedConnections(await invoke<TerminalSavedConnection[]>('config_list'))
    } catch {
      setSavedConnections([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="terminal-tab-strip" style={terminalCssVariables}>
      <button className="terminal-tab-mobile-nav previous" onClick={() => activateRelative(-1)} disabled={sessions.length < 2} title={t('terminal.actions.previousSession')} aria-label={t('terminal.actions.previousSession')}>‹</button>
      <div className="terminal-tab-list" role="tablist">
        {sessions.map(session => (
          <TerminalTab
            key={session.id}
            session={session}
            active={session.id === activeId}
            onActivate={() => onActivate(session.id)}
            onClose={() => onClose(session.id)}
            onDragStart={() => setDraggingId(session.id)}
            onDrop={() => {
              if (draggingId && draggingId !== session.id) onReorder(draggingId, session.id)
              setDraggingId(null)
            }}
          />
        ))}
      </div>
      <button className="terminal-tab-mobile-nav next" onClick={() => activateRelative(1)} disabled={sessions.length < 2} title={t('terminal.actions.nextSession')} aria-label={t('terminal.actions.nextSession')}>›</button>
      <button className="terminal-strip-button add" onClick={onNewSession} title={t('terminal.actions.newSession')} aria-label={t('terminal.actions.newSession')}>+</button>
      <div className="terminal-session-menu-wrap" ref={menuRef}>
        <button className={`terminal-strip-button ${menuOpen ? 'active' : ''}`} onClick={toggleMenu} title={t('terminal.tabs.sessionMenu')} aria-label={t('terminal.tabs.sessionMenu')}>⌄</button>
        {menuOpen && (
          <div className="terminal-session-menu">
            <div className="terminal-session-menu-title">{t('terminal.tabs.savedServers')}</div>
            {loading && <div className="terminal-session-menu-empty">…</div>}
            {!loading && savedConnections.length === 0 && <div className="terminal-session-menu-empty">{t('terminal.tabs.noRecentSessions')}</div>}
            {!loading && savedConnections.map(connection => {
              const active = sessions.some(session => session.configId === connection.id && session.state.kind === 'connected')
              return (
                <button key={connection.id} onClick={() => { setMenuOpen(false); onConnect(connection) }}>
                  <span className={`terminal-menu-status ${active ? 'connected' : ''}`} />
                  <span>
                    <strong>{connection.name || connection.host}</strong>
                    <small dir="ltr">{connection.username}@{connection.host}:{connection.port}</small>
                  </span>
                </button>
              )
            })}
            <div className="terminal-session-menu-divider" />
            <button onClick={() => { setMenuOpen(false); onNewSession() }}>
              <span className="terminal-menu-plus">+</span>
              <span><strong>{t('terminal.actions.newSession')}</strong></span>
            </button>
          </div>
        )}
      </div>
      <span className="terminal-tab-strip-spacer" />
      <button
        className="terminal-strip-button command"
        onClick={onOpenCommandPalette}
        disabled={!commandAvailable}
        title={t('terminal.tabs.terminalMenu')}
        aria-label={t('terminal.tabs.terminalMenu')}
      >•••</button>
    </div>
  )
}
