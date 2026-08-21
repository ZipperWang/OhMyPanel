import { useTranslation } from 'react-i18next'
import type { TerminalConnectionState } from './types'

interface TerminalConnectionOverlayProps {
  state: TerminalConnectionState
  target: string
  onReconnect?: () => void
  onCancelReconnect?: () => void
  onCloseSession?: () => void
  onEditConnection?: () => void
}

export default function TerminalConnectionOverlay({ state, target, onReconnect, onCancelReconnect, onCloseSession, onEditConnection }: TerminalConnectionOverlayProps) {
  const { t } = useTranslation()

  if (state.kind === 'connected') return null

  if (state.kind === 'reconnecting') {
    return (
      <div className="terminal-reconnect-banner">
        <span className="terminal-status-spinner" aria-hidden="true" />
        <span>{t('terminal.connection.reconnectingMessage', { attempt: state.attempt, max: state.max })}</span>
        <button onClick={onCancelReconnect}>{t('common.stop')}</button>
      </div>
    )
  }

  if (state.kind === 'connecting') {
    return (
      <div className="terminal-state-center passive">
        <span className="terminal-status-spinner" aria-hidden="true" />
        <strong>{t('terminal.connection.connectingTo', { target })}</strong>
        <span>{t('terminal.connection.establishing')}</span>
      </div>
    )
  }

  const authenticationFailed = state.kind === 'authentication-failed'
  return (
    <div className="terminal-state-center">
      <span className={`terminal-state-symbol ${authenticationFailed ? 'danger' : ''}`} aria-hidden="true">{authenticationFailed ? '!' : '×'}</span>
      <strong>{authenticationFailed ? t('terminal.status.authenticationFailed') : t('terminal.connection.closedTitle')}</strong>
      <span>{authenticationFailed ? (state.message || t('terminal.connection.authHint')) : (state.reason || t('terminal.connection.sessionEnded'))}</span>
      <div className="terminal-state-actions">
        {authenticationFailed && onEditConnection && <button onClick={onEditConnection}>{t('terminal.actions.connectionSettings')}</button>}
        {onReconnect && <button className="primary" onClick={onReconnect}>{t('common.retry')}</button>}
        {onCloseSession && <button onClick={onCloseSession}>{t('terminal.actions.closeCurrent')}</button>}
      </div>
    </div>
  )
}
