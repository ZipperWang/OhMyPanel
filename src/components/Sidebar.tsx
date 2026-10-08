import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { useTranslation } from 'react-i18next'
import Icon from './icons'
import ConnectionDialog, { type ConnectionDraft } from './ConnectionDialog'
import { DISCUSSIONS_URL, NAV_GROUPS, type PanelSection } from './navigation'

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: string
  key_path?: string
  password?: string
  remember_me?: boolean
}

interface SidebarProps {
  connections: Connection[]
  onConnectionsChanged: () => Promise<void> | void
  onSelect: (conn: Connection) => void
  onConnect: (conn: Connection) => void
  onCreateConnection: (data: ConnectionDraft) => Promise<void>
  connectedIds?: string[]
  connectingIds?: string[]
  activeConfigId?: string | null
  section: PanelSection
  navEnabled: boolean
  onNavigate: (section: PanelSection) => void
  onNavigateBlocked?: () => void
  theme: string
  onToggleTheme: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  newConnectionRequestId?: number
  editConnectionRequest?: { id: string; requestId: number } | null
  onNewConnectionRequestHandled?: (requestId: number) => void
  onEditConnectionRequestHandled?: (requestId: number) => void
}

interface ContextMenu {
  x: number
  y: number
  conn: Connection
}

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
  { code: 'pt', label: 'Português' },
  { code: 'ar', label: 'العربية' },
]

const AVATAR_HUES = [217, 262, 190, 152, 28, 336, 45, 280]

// ponytail：根据名称生成稳定的头像色相，方便在多台服务器间快速辨认
export function serverHue(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]
}

export function ServerAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const letter = (name.trim()[0] || '?').toUpperCase()
  return (
    <span className={`server-avatar ${size}`} style={{ '--avatar-hue': serverHue(name) } as React.CSSProperties}>
      {letter}
    </span>
  )
}

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

export default function Sidebar({
  connections, onConnectionsChanged, onSelect, onConnect, onCreateConnection, connectedIds, connectingIds, activeConfigId,
  section, navEnabled, onNavigate, onNavigateBlocked, theme, onToggleTheme, collapsed, onToggleCollapsed,
  newConnectionRequestId = 0, editConnectionRequest, onNewConnectionRequestHandled, onEditConnectionRequestHandled,
}: SidebarProps) {
  const { t, i18n } = useTranslation()
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [creating, setCreating] = useState<ConnectionDraft | null>(null)
  const switcher = usePopover()
  const langMenu = usePopover()
  const menuRef = useRef<HTMLDivElement>(null)
  const lastNewConnectionRequestRef = useRef(0)
  const lastEditConnectionRequestRef = useRef<number | null>(null)
  const onNewConnectionRequestHandledRef = useRef(onNewConnectionRequestHandled)
  const onEditConnectionRequestHandledRef = useRef(onEditConnectionRequestHandled)

  useEffect(() => {
    onNewConnectionRequestHandledRef.current = onNewConnectionRequestHandled
    onEditConnectionRequestHandledRef.current = onEditConnectionRequestHandled
  }, [onNewConnectionRequestHandled, onEditConnectionRequestHandled])

  const openNewConnection = useCallback(() => {
    setEditing(null)
    setConfirmDelete(null)
    setContextMenu(null)
    switcher.setOpen(false)
    setCreating({ name: '', host: '', port: 22, username: 'root', auth_type: 'password', password: '', remember_me: true })
  }, [switcher.setOpen])

  const openEditor = useCallback(async (conn: Connection) => {
    switcher.setOpen(false)
    setContextMenu(null)
    setCreating(null)
    setConfirmDelete(null)
    // 编辑前重新读取，确保拿到最新的凭据配置
    const list = await invoke<Connection[]>('config_list').catch(() => [] as Connection[])
    const fresh = list.find(item => item.id === conn.id)
    setEditing(fresh ? { ...fresh } : { ...conn })
  }, [switcher.setOpen])

  // 点击外部时关闭上下文菜单
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  useEffect(() => {
    if (newConnectionRequestId <= 0) {
      lastNewConnectionRequestRef.current = 0
      return
    }
    if (lastNewConnectionRequestRef.current === newConnectionRequestId) return
    lastNewConnectionRequestRef.current = newConnectionRequestId
    openNewConnection()
    onNewConnectionRequestHandledRef.current?.(newConnectionRequestId)
  }, [newConnectionRequestId, openNewConnection])

  useEffect(() => {
    if (!editConnectionRequest) {
      lastEditConnectionRequestRef.current = null
      return
    }
    if (lastEditConnectionRequestRef.current === editConnectionRequest.requestId) return
    lastEditConnectionRequestRef.current = editConnectionRequest.requestId
    const { id, requestId } = editConnectionRequest
    const target = connections.find(item => item.id === id)
    const done = () => onEditConnectionRequestHandledRef.current?.(requestId)
    if (target) void openEditor(target).finally(done)
    else {
      invoke<Connection[]>('config_list')
        .then(list => {
          const found = list.find(item => item.id === id)
          if (found) setEditing({ ...found })
        })
        .catch(() => {})
        .finally(done)
    }
  }, [editConnectionRequest?.id, editConnectionRequest?.requestId]) // eslint-disable-line

  const handleDelete = async (id: string) => {
    const result = await invoke<{ remoteKeyRevoked: boolean; warning?: string }>('config_delete', { id })
    setConfirmDelete(null)
    setEditing(null)
    await onConnectionsChanged()
    if (result.warning) window.alert(result.warning)
  }

  const handleSaveEdit = async (draft: ConnectionDraft) => {
    await invoke('config_save', { connection: draft })
    setEditing(null)
    await onConnectionsChanged()
  }

  const handleSaveAndConnect = async (draft: ConnectionDraft) => {
    await invoke('config_save', { connection: draft })
    setEditing(null)
    await onConnectionsChanged()
    // 通过自定义事件触发重连
    window.dispatchEvent(new CustomEvent('sidebar-reconnect-after-edit', { detail: { conn: draft } }))
  }

  const handleCreate = async (draft: ConnectionDraft) => {
    await onCreateConnection(draft)
    setCreating(null)
  }

  const statusOf = (id: string) => {
    if (connectedIds?.includes(id)) return 'connected'
    if (connectingIds?.includes(id)) return 'connecting'
    return 'idle'
  }

  const toggleConnection = (conn: Connection) => {
    if (statusOf(conn.id) === 'connected') {
      window.dispatchEvent(new CustomEvent('sidebar-disconnect', { detail: { configId: conn.id } }))
    } else {
      onConnect(conn)
    }
  }

  const activeConn = connections.find(conn => conn.id === activeConfigId) ?? null
  const activeStatus = activeConn ? statusOf(activeConn.id) : 'idle'

  return (
    <aside className={`sb ${collapsed ? 'collapsed' : ''}`}>
      <div className="sb-brand">
        <img className="sb-logo" src="/app-icon.png" alt="" draggable={false} />
        <span className="sb-brand-name">OhMyPanel</span>
        <button className="ui-icon-btn sb-collapse" onClick={onToggleCollapsed} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')} aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
          <Icon name="panelLeft" />
        </button>
      </div>

      {/* 服务器切换器 */}
      <div className="sb-switcher-wrap" ref={switcher.ref}>
        <button
          className={`sb-switcher ${switcher.open ? 'open' : ''}`}
          onClick={() => switcher.setOpen(!switcher.open)}
          title={activeConn ? `${activeConn.name || activeConn.host} · ${activeConn.username}@${activeConn.host}` : t('sidebar.servers')}
        >
          {activeConn ? <ServerAvatar name={activeConn.name || activeConn.host} /> : <span className="server-avatar md empty"><Icon name="server" size={15} /></span>}
          <span className="sb-switcher-text">
            <span className="sb-switcher-name">{activeConn ? (activeConn.name || activeConn.host) : t('sidebar.selectServer')}</span>
            <span className="sb-switcher-sub">
              {activeConn ? (
                <><span className={`status-dot ${activeStatus}`} />{activeConn.username}@{activeConn.host}</>
              ) : t('sidebar.serverCount', { count: connections.length })}
            </span>
          </span>
          <Icon name="chevronsUpDown" className="sb-switcher-caret" />
        </button>

        {switcher.open && (
          <div className="ui-popover sb-switcher-menu">
            <div className="ui-popover-header">
              <span>{t('sidebar.servers')}</span>
              <button className="ui-icon-btn sm" onClick={openNewConnection} title={t('sidebar.newConnection')} aria-label={t('sidebar.newConnection')}>
                <Icon name="plus" />
              </button>
            </div>
            <div className="sb-server-list">
              {connections.length === 0 && <div className="ui-popover-empty">{t('sidebar.clickToAdd')}</div>}
              {connections.map(conn => {
                const status = statusOf(conn.id)
                return (
                  <div
                    key={conn.id}
                    data-conn-id={conn.id}
                    className={`sb-server ${conn.id === activeConfigId ? 'active' : ''}`}
                    onClick={() => { switcher.setOpen(false); onSelect(conn) }}
                    onContextMenu={event => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, conn }) }}
                  >
                    <ServerAvatar name={conn.name || conn.host} size="sm" />
                    <span className="sb-server-text">
                      <span className="sb-server-name">{conn.name || conn.host}</span>
                      <span className="sb-server-sub" dir="ltr">{conn.username}@{conn.host}{conn.port !== 22 ? `:${conn.port}` : ''}</span>
                    </span>
                    <span className={`status-dot ${status}`} title={status === 'connected' ? t('sidebar.connected') : status === 'connecting' ? t('common.connecting') : t('sidebar.notConnected')} />
                    <span className="sb-server-actions">
                      <button
                        className="ui-icon-btn sm"
                        onClick={event => { event.stopPropagation(); void openEditor(conn) }}
                        title={t('common.edit')}
                        aria-label={t('common.edit')}
                      >
                        <Icon name="pencil" size={14} />
                      </button>
                      <button
                        className={`ui-icon-btn sm ${status === 'connected' ? 'danger' : ''}`}
                        onClick={event => { event.stopPropagation(); toggleConnection(conn) }}
                        disabled={status === 'connecting'}
                        title={status === 'connected' ? t('common.disconnect') : t('common.connect')}
                        aria-label={status === 'connected' ? t('common.disconnect') : t('common.connect')}
                      >
                        <Icon name="power" size={14} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
            <button className="ui-popover-action" onClick={openNewConnection}>
              <Icon name="plus" />
              {t('sidebar.newConnection')}
            </button>
          </div>
        )}
      </div>

      {/* 功能导航 */}
      <nav className={`sb-nav ${navEnabled ? '' : 'disabled'}`}>
        {NAV_GROUPS.map(group => (
          <div className="sb-nav-group" key={group.key}>
            <div className="sb-nav-label">{t(group.labelKey)}</div>
            {group.items.map(item => (
              <button
                key={item.key}
                className={`sb-nav-item ${navEnabled && section === item.key ? 'active' : ''}`}
                onClick={() => navEnabled ? onNavigate(item.key) : onNavigateBlocked?.()}
                title={collapsed ? t(item.labelKey) : undefined}
              >
                <Icon name={item.icon} size={17} />
                <span className="sb-nav-text">{t(item.labelKey)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sb-footer">
        <button className="ui-icon-btn" onClick={onToggleTheme} title={theme === 'dark' ? t('settings.light') : t('settings.dark')} aria-label={t('settings.theme')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <div className="sb-lang" ref={langMenu.ref}>
          <button className={`ui-icon-btn ${langMenu.open ? 'active' : ''}`} onClick={() => langMenu.setOpen(!langMenu.open)} title={t('sidebar.language')} aria-label={t('sidebar.language')}>
            <Icon name="languages" />
          </button>
          {langMenu.open && (
            <div className="ui-popover sb-lang-menu">
              {LANGUAGES.map(language => (
                <button
                  key={language.code}
                  className={`ui-menu-item ${i18n.language === language.code ? 'active' : ''}`}
                  onClick={() => {
                    i18n.changeLanguage(language.code)
                    invoke('ui_state_set', { key: 'language', value: language.code }).catch(() => {})
                    langMenu.setOpen(false)
                  }}
                >
                  <span>{language.label}</span>
                  {i18n.language === language.code && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="ui-icon-btn" onClick={() => openExternal(DISCUSSIONS_URL)} title={t('nav.discussions')} aria-label={t('nav.discussions')}>
          <Icon name="message" />
        </button>
      </div>

      {/* 上下文菜单 */}
      {contextMenu && (
        <div ref={menuRef} className="ui-popover ui-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button className="ui-menu-item" onClick={() => { toggleConnection(contextMenu.conn); setContextMenu(null); switcher.setOpen(false) }}>
            <Icon name="power" size={14} />
            <span>{statusOf(contextMenu.conn.id) === 'connected' ? t('common.disconnect') : t('common.connect')}</span>
          </button>
          <button className="ui-menu-item" onClick={() => void openEditor(contextMenu.conn)}>
            <Icon name="pencil" size={14} />
            <span>{t('common.edit')}</span>
          </button>
          <div className="ui-menu-divider" />
          <button
            className="ui-menu-item danger"
            onClick={() => {
              setConfirmDelete({ id: contextMenu.conn.id, name: contextMenu.conn.name || contextMenu.conn.host })
              setContextMenu(null)
              switcher.setOpen(false)
            }}
          >
            <Icon name="trash" size={14} />
            <span>{t('common.delete')}</span>
          </button>
        </div>
      )}

      {editing && (
        <ConnectionDialog
          key={`edit-${editing.id}`}
          mode="edit"
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSaveEdit}
          onSaveAndConnect={handleSaveAndConnect}
          onDelete={() => setConfirmDelete({ id: editing.id, name: editing.name || editing.host })}
        />
      )}
      {creating && (
        <ConnectionDialog
          key="create"
          mode="create"
          initial={creating}
          onCancel={() => setCreating(null)}
          onSave={handleCreate}
        />
      )}

      {/* 确认删除对话框 */}
      {confirmDelete && (
        <div className="ui-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="ui-dialog sm" onClick={e => e.stopPropagation()}>
            <div className="ui-dialog-header">
              <div className="ui-dialog-title">{t('sidebar.confirmDelete')}</div>
            </div>
            <div className="ui-dialog-body">
              <p className="ui-dialog-text">{t('sidebar.deleteConfirmMsg', { name: confirmDelete.name })}</p>
            </div>
            <div className="ui-dialog-footer">
              <span className="ui-spacer" />
              <button className="ui-btn" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button className="ui-btn danger" onClick={() => handleDelete(confirmDelete.id)}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
