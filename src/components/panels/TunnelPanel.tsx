import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'

interface TunnelInfo {
  id: string
  session_id: string
  tunnel_type: string
  local_host: string
  local_port: number
  remote_host: string
  remote_port: number
  status: string
}

interface TunnelPanelProps {
  sessionId: string | null
}

type TunnelType = 'local' | 'remote' | 'dynamic'

export default function TunnelPanel({ sessionId }: TunnelPanelProps) {
  const { t } = useTranslation()
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [tunnelType, setTunnelType] = useState<TunnelType>('local')
  const [localHost, setLocalHost] = useState('127.0.0.1')
  const [localPort, setLocalPort] = useState('')
  const [remoteHost, setRemoteHost] = useState('127.0.0.1')
  const [remotePort, setRemotePort] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadTunnels = useCallback(async () => {
    try {
      setLoading(true)
      const result = await invoke<string>('tunnel_list')
      const allTunnels: TunnelInfo[] = JSON.parse(result)
      setTunnels(allTunnels.filter(t => t.session_id === sessionId))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadTunnels()

    const unlistenCreated = listen('tunnel-created', () => loadTunnels())
    const unlistenStatus = listen('tunnel-status', () => loadTunnels())
    const unlistenError = listen<{ tunnelId: string; error: string }>('tunnel-error', (event) => {
      setError(event.payload.error)
    })

    return () => {
      unlistenCreated.then(fn => fn())
      unlistenStatus.then(fn => fn())
      unlistenError.then(fn => fn())
    }
  }, [sessionId, loadTunnels])

  const isValidPort = (port: string): boolean => {
    const num = parseInt(port)
    return !isNaN(num) && num >= 1 && num <= 65535
  }

  const isPortInUse = (port: number): boolean =>
    tunnels.some(t => t.local_port === port && t.local_host === localHost)

  const handleCreate = async () => {
    if (!sessionId) return

    if (!localPort || !isValidPort(localPort)) {
      setError(t('tunnel.invalidPort'))
      return
    }
    if (isPortInUse(parseInt(localPort))) {
      setError(t('tunnel.portInUse'))
      return
    }
    if (tunnelType !== 'dynamic' && (!remotePort || !isValidPort(remotePort))) {
      setError(t('tunnel.invalidRemotePort'))
      return
    }

    setCreating(true)
    setError('')

    try {
      await invoke('tunnel_create', {
        sessionId,
        tunnelType,
        localHost,
        localPort: parseInt(localPort),
        remoteHost: tunnelType === 'dynamic' ? '' : remoteHost,
        remotePort: tunnelType === 'dynamic' ? 0 : parseInt(remotePort),
      })
      setMsg(t('tunnel.created'))
      setShowCreate(false)
      resetForm()
      loadTunnels()
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleClose = async (tunnelId: string) => {
    try {
      await invoke('tunnel_close', { tunnelId })
      setMsg(t('tunnel.closed'))
      loadTunnels()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleCopy = async (tunnel: TunnelInfo) => {
    try {
      await navigator.clipboard.writeText(`${tunnel.local_host}:${tunnel.local_port}`)
      setCopiedId(tunnel.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (e) {
      setError(String(e))
    }
  }

  const resetForm = () => {
    setTunnelType('local')
    setLocalHost('127.0.0.1')
    setLocalPort('')
    setRemoteHost('127.0.0.1')
    setRemotePort('')
    setError('')
  }

  const getTunnelDescription = (tunnel: TunnelInfo) => {
    switch (tunnel.tunnel_type) {
      case 'local':
        return `${tunnel.local_host}:${tunnel.local_port} → ${tunnel.remote_host}:${tunnel.remote_port}`
      case 'remote':
        return `${tunnel.remote_host}:${tunnel.remote_port} → ${tunnel.local_host}:${tunnel.local_port}`
      case 'dynamic':
        return `${tunnel.local_host}:${tunnel.local_port} (SOCKS5)`
      default:
        return ''
    }
  }

  const getConnectionCommand = (tunnel: TunnelInfo): string => {
    if (tunnel.tunnel_type === 'dynamic') {
      return `export ALL_PROXY=socks5://${tunnel.local_host}:${tunnel.local_port}`
    }
    const portCommands: Record<number, string> = {
      3306: `mysql -h ${tunnel.local_host} -P ${tunnel.local_port} -u root -p`,
      5432: `psql -h ${tunnel.local_host} -p ${tunnel.local_port} -U postgres`,
      6379: `redis-cli -h ${tunnel.local_host} -p ${tunnel.local_port}`,
      27017: `mongosh "mongodb://${tunnel.local_host}:${tunnel.local_port}"`,
    }
    return portCommands[tunnel.remote_port] || `${tunnel.local_host}:${tunnel.local_port}`
  }

  const quickActions = [
    { label: t('tunnel.quick.mysql'), port: 3306 },
    { label: t('tunnel.quick.redis'), port: 6379 },
    { label: t('tunnel.quick.postgres'), port: 5432 },
    { label: t('tunnel.quick.mongodb'), port: 27017 },
  ]

  const handleQuickAction = (port: number) => {
    setTunnelType('local')
    setLocalHost('127.0.0.1')
    setLocalPort(String(port))
    setRemoteHost('127.0.0.1')
    setRemotePort(String(port))
    setShowCreate(true)
  }

  const getTypeColor = (type: string): string => {
    switch (type) {
      case 'local': return '#2196F3'
      case 'remote': return '#FF9800'
      case 'dynamic': return '#9C27B0'
      default: return '#666'
    }
  }

  if (!sessionId) {
    return (
      <div className="panel-container">
        <div className="panel-header">
          <h2>{t('tunnel.title')}</h2>
        </div>
        <div className="alert alert-error">{t('tunnel.notConnected')}</div>
      </div>
    )
  }

  const canSubmit = localPort !== '' && isValidPort(localPort) && !isPortInUse(parseInt(localPort)) &&
    (tunnelType === 'dynamic' || (remotePort !== '' && isValidPort(remotePort)))

  return (
    <div className="panel-container">
      {/* Header */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2>{t('tunnel.title')}</h2>
          {tunnels.length > 0 && (
            <span style={{ fontSize: '12px', color: '#3fb950', fontWeight: 'bold' }}>
              {tunnels.length} {t('tunnel.active')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={loadTunnels} disabled={loading}>
            {t('common.refresh')}
          </button>
          <button className="btn-primary" onClick={() => { resetForm(); setShowCreate(true) }}>
            {t('tunnel.create')}
          </button>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div className="alert alert-success">{msg}</div>
      )}
      {error && (
        <div className="alert alert-error">{error}</div>
      )}

      {/* Quick Actions */}
      <div className="toolbar">
        <span style={{ fontSize: '13px', color: '#8b949e', whiteSpace: 'nowrap' }}>
          {t('tunnel.quickActions')}
        </span>
        {quickActions.map(action => (
          <button
            key={action.port}
            className="btn-secondary"
            onClick={() => handleQuickAction(action.port)}
          >
            {action.label} <span style={{ color: '#8b949e' }}>:{action.port}</span>
          </button>
        ))}
      </div>

      {/* Tunnel Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.status')}</th>
              <th>{t('tunnel.type')}</th>
              <th>{t('tunnel.mapping')}</th>
              <th>{t('tunnel.usageHint')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                  {t('common.loading')}
                </td>
              </tr>
            ) : tunnels.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                  <div>{t('tunnel.empty')}</div>
                  <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
                    {t('tunnel.emptyHint')}
                  </div>
                </td>
              </tr>
            ) : (
              tunnels.map(tunnel => (
                <tr key={tunnel.id}>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: tunnel.status === 'active' ? '#3fb950' : '#8b949e',
                      marginRight: '6px',
                    }} />
                    {tunnel.status}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '3px',
                      backgroundColor: getTypeColor(tunnel.tunnel_type),
                      color: '#fff',
                      fontSize: '12px',
                    }}>
                      {t(`tunnel.types.${tunnel.tunnel_type}`)}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {getTunnelDescription(tunnel)}
                  </td>
                  <td>
                    <span
                      style={{ fontFamily: 'monospace', fontSize: '12px', cursor: 'pointer', color: '#58a6ff' }}
                      title={t('common.copy')}
                      onClick={() => handleCopy(tunnel)}
                    >
                      {copiedId === tunnel.id ? '✓' : getConnectionCommand(tunnel)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="action-link"
                      onClick={() => handleCopy(tunnel)}
                    >
                      {copiedId === tunnel.id ? t('common.copied') : t('common.copy')}
                    </button>
                    <button
                      className="action-link danger"
                      onClick={() => handleClose(tunnel.id)}
                    >
                      {t('common.close')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreate(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close-btn"
              onClick={() => setShowCreate(false)}
              title="Close"
            >×</button>
            <h3>{t('tunnel.create')}</h3>

            {/* Tunnel Type */}
            <div className="form-group">
              <label>{t('tunnel.type')}:</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['local', 'remote', 'dynamic'] as TunnelType[]).map(type => (
                  <button
                    key={type}
                    className={tunnelType === type ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => setTunnelType(type)}
                  >
                    {t(`tunnel.types.${type}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Local Settings */}
            <div className="form-row">
              <div className="form-group">
                <label>{t('tunnel.localHost')}:</label>
                <input
                  type="text"
                  value={localHost}
                  onChange={e => setLocalHost(e.target.value)}
                  className="form-input"
                  placeholder="127.0.0.1"
                />
              </div>
              <div className="form-group">
                <label>{t('tunnel.localPort')}:</label>
                <input
                  type="number"
                  value={localPort}
                  onChange={e => setLocalPort(e.target.value)}
                  min="1"
                  max="65535"
                  className="form-input"
                  placeholder="3306"
                />
              </div>
            </div>

            {/* Remote Settings */}
            {tunnelType !== 'dynamic' && (
              <div className="form-row">
                <div className="form-group">
                  <label>{t('tunnel.remoteHost')}:</label>
                  <input
                    type="text"
                    value={remoteHost}
                    onChange={e => setRemoteHost(e.target.value)}
                    className="form-input"
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="form-group">
                  <label>{t('tunnel.remotePort')}:</label>
                  <input
                    type="number"
                    value={remotePort}
                    onChange={e => setRemotePort(e.target.value)}
                    min="1"
                    max="65535"
                    className="form-input"
                    placeholder="3306"
                  />
                </div>
              </div>
            )}

            {/* Inline validation hints */}
            {localPort && !isValidPort(localPort) && (
              <div style={{ color: '#f85149', fontSize: '12px' }}>{t('tunnel.invalidPort')}</div>
            )}
            {localPort && isValidPort(localPort) && isPortInUse(parseInt(localPort)) && (
              <div style={{ color: '#d29922', fontSize: '12px' }}>{t('tunnel.portInUse')}</div>
            )}

            {/* Description */}
            <div style={{
              fontSize: '12px',
              color: '#8b949e',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '10px 12px',
            }}>
              {t(`tunnel.desc.${tunnelType}`)}
            </div>

            {error && (
              <div className="alert alert-error" style={{ marginBottom: 0 }}>{error}</div>
            )}

            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowCreate(false)}
                disabled={creating}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={creating || !canSubmit}
              >
                {creating ? t('common.creating') : t('tunnel.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
