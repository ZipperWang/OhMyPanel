import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

interface Connection {
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

interface NewConnectionData {
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
  onSelect: (conn: Connection) => void
  onConnect: (conn: Connection) => void
  onNew: () => void
  onCreateConnection: (data: NewConnectionData) => Promise<void>
  refreshKey?: number
  connectedIds?: string[]
  connectingIds?: string[]
  activeConfigId?: string | null
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

const authUsesPassword = (authType: string) => authType === 'password' || authType === 'managed_key_password'
const authUsesKey = (authType: string) => authType === 'key' || authType === 'managed_key' || authType === 'managed_key_password'

export default function Sidebar({ onSelect, onConnect, onNew, onCreateConnection, refreshKey, connectedIds, connectingIds, activeConfigId, newConnectionRequestId = 0, editConnectionRequest, onNewConnectionRequestHandled, onEditConnectionRequestHandled }: SidebarProps) {
  const { t, i18n } = useTranslation()
  const [connections, setConnections] = useState<Connection[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [showEditPassword, setShowEditPassword] = useState(false)
  const [creating, setCreating] = useState<NewConnectionData | null>(null)
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const langRef = useRef<HTMLDivElement>(null)
  const hasCheckedEmptyRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const lastNewConnectionRequestRef = useRef(0)
  const lastEditConnectionRequestRef = useRef<number | null>(null)
  const onNewConnectionRequestHandledRef = useRef(onNewConnectionRequestHandled)
  const onEditConnectionRequestHandledRef = useRef(onEditConnectionRequestHandled)

  useEffect(() => {
    onNewConnectionRequestHandledRef.current = onNewConnectionRequestHandled
    onEditConnectionRequestHandledRef.current = onEditConnectionRequestHandled
  }, [onNewConnectionRequestHandled, onEditConnectionRequestHandled])

  const openNewConnection = useCallback(() => {
    setShowCreatePassword(false)
    setEditing(null)
    setConfirmDelete(null)
    setContextMenu(null)
    setCreating({
      name: '',
      host: '',
      port: 22,
      username: 'root',
      auth_type: 'password',
      password: '',
      remember_me: true
    })
  }, [])

  const loadConnections = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current
    let list: Connection[]
    try {
      list = await invoke<Connection[]>('config_list')
    } catch {
      return
    }
    if (!mountedRef.current || requestId !== loadRequestIdRef.current) return
    setConnections(list)

    if (!hasCheckedEmptyRef.current) {
      hasCheckedEmptyRef.current = true
      if (list.length === 0) openNewConnection()
    }
  }, [openNewConnection])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadRequestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  // refreshKey 变化时刷新
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      void loadConnections()
    }
  }, [refreshKey, loadConnections])

  // 点击外部时关闭上下文菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    if (contextMenu) {
      window.addEventListener('mousedown', handleClick)
      return () => window.removeEventListener('mousedown', handleClick)
    }
  }, [contextMenu])

  // 点击外部时关闭语言下拉菜单
  useEffect(() => {
    if (!langDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [langDropdownOpen])

  const handleDelete = async (id: string) => {
    const result = await invoke<{ remoteKeyRevoked: boolean; warning?: string }>('config_delete', { id })
    setConfirmDelete(null)
    await loadConnections()
    if (result.warning) window.alert(result.warning)
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    // 清理主机、用户名和端口两端的空白
    const trimmed = {
      ...editing,
      host: editing.host.trim(),
      username: editing.username.trim(),
      port: Number(String(editing.port).trim()) || editing.port,
      remember_me: editing.remember_me || false,
      // 仅在勾选 remember_me 时保存凭据
      password: editing.remember_me ? editing.password : undefined,
      key_path: editing.remember_me ? editing.key_path : undefined
    }
    await invoke('config_save', { connection: trimmed })
    setEditing(null)
    await loadConnections()
  }

  const handleSaveAndConnect = async () => {
    if (!editing) return
    
    // 先保存
    const trimmed = {
      ...editing,
      host: editing.host.trim(),
      username: editing.username.trim(),
      port: Number(String(editing.port).trim()) || editing.port,
      remember_me: editing.remember_me || false,
      // 仅在勾选 remember_me 时保存凭据
      password: editing.remember_me ? editing.password : undefined,
      key_path: editing.remember_me ? editing.key_path : undefined
    }
    await invoke('config_save', { connection: trimmed })
    
    setEditing(null)
    await loadConnections()
    
    // 通过自定义事件触发重连
    window.dispatchEvent(new CustomEvent('sidebar-reconnect-after-edit', {
      detail: { conn: trimmed }
    }))
  }

  const pickKeyFile = async () => {
    const path = await open()
    if (path) setEditing({ ...editing!, key_path: String(path) })
  }

  const pickCreateKeyFile = async () => {
    const path = await open()
    if (path && creating) setCreating({ ...creating, key_path: String(path) })
  }

  const handleSaveNewConnection = async () => {
    if (!creating) return
    // 清理主机、用户名和端口两端的空白
    const trimmed = {
      ...creating,
      host: creating.host.trim(),
      username: creating.username.trim(),
      port: Number(String(creating.port).trim()) || creating.port,
      remember_me: creating.remember_me || false,
      // 仅在勾选 remember_me 时保存凭据
      password: creating.remember_me ? creating.password : undefined,
      key_path: creating.remember_me ? creating.key_path : undefined
    }
    await onCreateConnection(trimmed)
    setCreating(null)
    await loadConnections()
  }

  const handleNewConnection = () => {
    hasCheckedEmptyRef.current = true
    openNewConnection()
    onNew()
  }

  useEffect(() => {
    if (newConnectionRequestId <= 0) {
      lastNewConnectionRequestRef.current = 0
      return
    }
    if (lastNewConnectionRequestRef.current === newConnectionRequestId) return
    lastNewConnectionRequestRef.current = newConnectionRequestId
    hasCheckedEmptyRef.current = true
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
    let cancelled = false
    const { id, requestId } = editConnectionRequest
    const openEditor = async () => {
      try {
        const list = await invoke<Connection[]>('config_list')
        if (cancelled) return
        const connection = list.find(item => item.id === id)
        if (connection) {
          setShowEditPassword(false)
          setCreating(null)
          setConfirmDelete(null)
          setContextMenu(null)
          setEditing({ ...connection })
        }
      } catch {
      } finally {
        if (!cancelled) onEditConnectionRequestHandledRef.current?.(requestId)
      }
    }
    void openEditor()
    return () => {
      cancelled = true
    }
  }, [editConnectionRequest?.id, editConnectionRequest?.requestId])

  const handleContextMenu = (e: React.MouseEvent, conn: Connection) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, conn })
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>{t('sidebar.servers')}</h2>
        <button className="btn-new" onClick={handleNewConnection} title={t('sidebar.newConnection')}>
          +
        </button>
      </div>
      <div className="connection-list">
        {connections.length === 0 && (
          <p className="empty-hint">{t('sidebar.clickToAdd')}</p>
        )}
        {connections.map((conn) => {
          const isConnected = connectedIds?.includes(conn.id) ?? false
          const isConnecting = connectingIds?.includes(conn.id) ?? false
          const showConnecting = isConnecting && !isConnected
          return (
            <div
              key={conn.id}
              className={`connection-item${conn.id === activeConfigId ? ' active' : ''}`}
              onClick={() => onSelect(conn)}
              onContextMenu={(e) => handleContextMenu(e, conn)}
            >
              <div className="conn-info">
                <span className="conn-name">{conn.name || conn.host}</span>
                <span className="conn-detail">
                  {conn.username}@{conn.host}:{conn.port}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`btn-connect ${isConnected ? 'disconnect' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isConnected) {
                      // 断开此特定会话
                      window.dispatchEvent(new CustomEvent('sidebar-disconnect', { detail: { configId: conn.id } }))
                    } else {
                      onConnect(conn)
                    }
                  }}
                  title={isConnected ? t('common.disconnect') : t('common.connect')}
                  disabled={showConnecting}
                >
                  {showConnecting ? t('common.connecting') : (isConnected ? t('common.disconnect') : t('common.connect'))}
                </button>
                <button
                  className="btn-edit"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const list = await invoke<Connection[]>('config_list')
                    const fresh = list.find(c => c.id === conn.id)
                    setEditing(fresh ? { ...fresh } : { ...conn })
                  }}
                  title={t('common.edit')}
                >
                  {t('common.edit')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 上下文菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              onConnect(contextMenu.conn)
              setContextMenu(null)
            }}
          >
            {t('common.connect')}
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              setEditing({ ...contextMenu.conn })
              setContextMenu(null)
            }}
          >
            {t('common.edit')}
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item danger"
            onClick={() => {
              setConfirmDelete({ id: contextMenu.conn.id, name: contextMenu.conn.name || contextMenu.conn.host })
              setContextMenu(null)
            }}
          >
            {t('common.delete')}
          </div>
        </div>
      )}
      {/* 编辑弹窗 */}
      {editing && (
        <div className="sidebar-confirm-overlay">
          <div className="sidebar-edit-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-edit-header">
              <div className="sidebar-confirm-title">{t('sidebar.editConnection')}</div>
              <button className="sidebar-edit-close" onClick={() => setEditing(null)}>×</button>
            </div>
            <div className="sidebar-edit-fields">
              <div className="form-group">
                <label>{t('sidebar.name')}</label>
                <input className="sidebar-edit-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('sidebar.host')}</label>
                  <input className="sidebar-edit-input" value={editing.host} onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
                </div>
                <div className="form-group fixed-width">
                  <label>{t('sidebar.port')}</label>
                  <input 
                    className="sidebar-edit-input" 
                    type="number" 
                    value={editing.port || ''} 
                    onChange={(e) => {
                      const val = e.target.value
                      setEditing({ ...editing, port: val === '' ? 0 : Number(val) })
                    }}
                    onBlur={(e) => {
                      const val = e.target.value
                      if (val === '' || val.trim() === '') {
                        setEditing({ ...editing, port: 0 })
                      }
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('sidebar.username')}</label>
                  <input className="sidebar-edit-input" value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
                </div>
                <div className="form-group medium-width">
                  <label>{t('sidebar.authType')}</label>
                  <select className="sidebar-edit-input" value={editing.auth_type} onChange={(e) => setEditing({ ...editing, auth_type: e.target.value, key_path: authUsesKey(e.target.value) ? editing.key_path : undefined, password: authUsesPassword(e.target.value) ? editing.password : undefined })}>
                    <option value="password">{t('sidebar.password')}</option>
                    <option value="key">Key File</option>
                    {editing.auth_type === 'managed_key' && <option value="managed_key">Managed Key</option>}
                    {editing.auth_type === 'managed_key_password' && <option value="managed_key_password">Managed Key + Password</option>}
                  </select>
                </div>
              </div>
              {authUsesPassword(editing.auth_type) && (
                <div className="form-group">
                  <label>{t('sidebar.password')}</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="sidebar-edit-input" style={{ flex: 1 }} type={showEditPassword ? 'text' : 'password'} value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
                    <button className="sidebar-edit-action-btn" onClick={() => setShowEditPassword(!showEditPassword)} title={showEditPassword ? t('sidebar.hidePassword') : t('sidebar.showPassword')}>{showEditPassword ? t('sidebar.hidePassword') : t('sidebar.showPassword')}</button>
                  </div>
                </div>
              )}
              {authUsesKey(editing.auth_type) && (
                <div className="form-group">
                  <label>{t('sidebar.keyPath')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="sidebar-edit-input" style={{ flex: 1 }} value={editing.key_path || ''} onChange={(e) => setEditing({ ...editing, key_path: e.target.value })} readOnly={editing.auth_type.startsWith('managed_')} />
                    <button className="sidebar-edit-action-btn" onClick={pickKeyFile} title={t('sidebar.browseKeyFile')} disabled={editing.auth_type.startsWith('managed_')}>{t('sidebar.browseKeyFile')}</button>
                  </div>
                </div>
              )}
            </div>
            <div className="sidebar-confirm-actions">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginRight: 'auto' }}>
                <input type="checkbox" checked={editing.remember_me || false} onChange={(e) => setEditing({ ...editing, remember_me: e.target.checked })} />
                <span style={{ color: 'red' }}>{t('sidebar.rememberMe')}</span>
              </label>
              <button className="sidebar-confirm-btn primary" onClick={handleSaveEdit}>{t('common.save')}</button>
              <button className="sidebar-confirm-btn connect" onClick={handleSaveAndConnect}>{t('common.connect')}</button>
            </div>
          </div>
        </div>
      )}
      {/* 确认删除对话框 */}
      {confirmDelete && (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="sidebar-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-confirm-title">{t('sidebar.confirmDelete')}</div>
            <div className="sidebar-confirm-msg">
              {t('sidebar.deleteConfirmMsg', { name: confirmDelete.name })}
            </div>
            <div className="sidebar-confirm-actions">
              <button className="sidebar-confirm-btn cancel" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button className="sidebar-confirm-btn danger" onClick={() => handleDelete(confirmDelete.id)}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
      {/* 新建连接弹窗 */}
      {creating && (
        <div className="sidebar-confirm-overlay">
          <div className="sidebar-edit-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-edit-header">
              <div className="sidebar-confirm-title">{t('sidebar.newConnection')}</div>
              <button className="sidebar-edit-close" onClick={() => setCreating(null)}>×</button>
            </div>
            <div className="sidebar-edit-fields">
              <div className="form-group">
                <label>{t('sidebar.name')}</label>
                <input className="sidebar-edit-input" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder={t('sidebar.serverName')} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('sidebar.host')}</label>
                  <input className="sidebar-edit-input" value={creating.host} onChange={(e) => setCreating({ ...creating, host: e.target.value })} placeholder="192.168.1.1" />
                </div>
                <div className="form-group fixed-width">
                  <label>{t('sidebar.port')}</label>
                  <input 
                    className="sidebar-edit-input" 
                    type="number" 
                    value={creating.port || ''} 
                    onChange={(e) => {
                      const val = e.target.value
                      setCreating({ ...creating, port: val === '' ? 0 : Number(val) })
                    }}
                    onBlur={(e) => {
                      const val = e.target.value
                      if (val === '' || val.trim() === '') {
                        setCreating({ ...creating, port: 0 })
                      }
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('sidebar.username')}</label>
                  <input className="sidebar-edit-input" value={creating.username} onChange={(e) => setCreating({ ...creating, username: e.target.value })} placeholder="root" />
                </div>
                <div className="form-group medium-width">
                  <label>{t('sidebar.authType')}</label>
                  <select className="sidebar-edit-input" value={creating.auth_type} onChange={(e) => setCreating({ ...creating, auth_type: e.target.value, key_path: authUsesKey(e.target.value) ? creating.key_path : undefined, password: authUsesPassword(e.target.value) ? creating.password : undefined })}>
                    <option value="password">{t('sidebar.password')}</option>
                    <option value="key">Key File</option>
                  </select>
                </div>
              </div>
              {authUsesPassword(creating.auth_type) && (
                <div className="form-group">
                  <label>{t('sidebar.password')}</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="sidebar-edit-input" style={{ flex: 1 }} type={showCreatePassword ? 'text' : 'password'} value={creating.password || ''} onChange={(e) => setCreating({ ...creating, password: e.target.value })} placeholder={t('sidebar.enterPassword')} />
                    <button className="sidebar-edit-action-btn" onClick={() => setShowCreatePassword(!showCreatePassword)} title={showCreatePassword ? t('sidebar.hidePassword') : t('sidebar.showPassword')}>{showCreatePassword ? t('sidebar.hidePassword') : t('sidebar.showPassword')}</button>
                  </div>
                </div>
              )}
              {authUsesKey(creating.auth_type) && (
                <div className="form-group">
                  <label>{t('sidebar.keyPath')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="sidebar-edit-input" style={{ flex: 1 }} value={creating.key_path || ''} onChange={(e) => setCreating({ ...creating, key_path: e.target.value })} placeholder="~/.ssh/id_rsa" />
                    <button className="sidebar-edit-action-btn" onClick={pickCreateKeyFile} title={t('sidebar.browseKeyFile')}>{t('sidebar.browseKeyFile')}</button>
                  </div>
                </div>
              )}
            </div>
            <div className="sidebar-confirm-actions">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginRight: 'auto' }}>
                <input type="checkbox" checked={creating.remember_me || false} onChange={(e) => setCreating({ ...creating, remember_me: e.target.checked })} />
                <span style={{ color: 'red' }}>{t('sidebar.rememberMe')}</span>
              </label>
              <button className="sidebar-confirm-btn cancel" onClick={() => setCreating(null)}>{t('common.cancel')}</button>
              <button className="sidebar-confirm-btn primary" onClick={handleSaveNewConnection}>{t('common.create')}</button>
            </div>
          </div>
        </div>
      )}
      {/* 语言切换器 */}
      <div className="sidebar-language-switcher" ref={langRef} style={{ position: 'relative' }}>
        <button
          className="lang-toggle-btn"
          onClick={() => setLangDropdownOpen(!langDropdownOpen)}
        >
          {t('sidebar.language')} ▾
        </button>
        {langDropdownOpen && (
          <div className="lang-dropdown">
            {[
              { code: 'en', label: 'English' },
              { code: 'zh-CN', label: '简体中文' },
              { code: 'zh-TW', label: '繁體中文' },
              { code: 'ja', label: '日本語' },
              { code: 'fr', label: 'Français' },
              { code: 'de', label: 'Deutsch' },
              { code: 'ru', label: 'Русский' },
              { code: 'ar', label: 'العربية' },
              { code: 'pt', label: 'Português' },
              { code: 'ko', label: '한국어' },
            ].map(l => (
              <div
                key={l.code}
                className={`lang-dropdown-item${i18n.language === l.code ? ' active' : ''}`}
                onClick={() => {
                  i18n.changeLanguage(l.code)
                  invoke('ui_state_set', { key: 'language', value: l.code }).catch(() => {})
                  setLangDropdownOpen(false)
                }}
              >
                {l.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

