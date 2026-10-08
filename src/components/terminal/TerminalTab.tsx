import { useTranslation } from 'react-i18next'
import type { TerminalSessionTabModel } from './types'

interface TerminalTabProps {
  session: TerminalSessionTabModel
  active: boolean
  onActivate: () => void
  onClose: () => void
  onDragStart?: () => void
  onDrop?: () => void
}

export default function TerminalTab({ session, active, onActivate, onClose, onDragStart, onDrop }: TerminalTabProps) {
  const { t } = useTranslation()
  const statusLabel = t(`terminal.status.${session.state.kind === 'authentication-failed' ? 'authenticationFailed' : session.state.kind}`)
  const endpoint = `${session.username}@${session.host}:${session.port}`

  return (
    <div
      className={`terminal-tab-wrap ${active ? 'active' : ''}`}
      draggable
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={event => {
        event.preventDefault()
        onDrop?.()
      }}
    >
      <div
        className={`terminal-tab ${active ? 'active' : ''}`}
        role="tab"
        tabIndex={0}
        aria-selected={active}
        title={`SSH\n${endpoint}\n${statusLabel}\n${session.dimensions ? `${session.dimensions.cols} × ${session.dimensions.rows} · UTF-8` : 'UTF-8'}`}
        onClick={onActivate}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onActivate()
        }}
        onAuxClick={event => {
          if (event.button === 1) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <span className={`terminal-tab-status ${session.state.kind}`} aria-label={statusLabel} />
        <svg className="terminal-tab-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="10" rx="1.5" />
          <path d="m4 6 2 2-2 2M8 10h3" />
        </svg>
        <span className="terminal-tab-name" dir="ltr">{session.name}</span>
        {session.hasUnread && <span className="terminal-tab-unread" aria-label={t('terminal.status.newOutput')} />}
        <button
          type="button"
          className="terminal-tab-close"
          tabIndex={-1}
          aria-label={t('terminal.tabs.closeNamed', { name: session.name })}
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
        >×</button>
      </div>
    </div>
  )
}
