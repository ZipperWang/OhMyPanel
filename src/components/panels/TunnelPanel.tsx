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

interface QuickAction {
  label: string
  remotePort: number
  icon: string
  command?: string
}

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
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadTunnels = useCallback(async () => {
    try {
      setLoading(true)
      const result = await invoke<string>('tunnel_list')
      const allTunnels: TunnelInfo[] = JSON.parse(result)
      // Filter tunnels for current session
      setTunnels(allTunnels.filter(t => t.session_id === sessionId))
    } catch (e) {
      console.error('Failed to load tunnels:', e)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadTunnels()

    // Listen for tunnel events
    const unlistenCreated = listen('tunnel-created', () => {
      loadTunnels()
    })

    const unlistenStatus = listen<{ tunnelId: string; status: string; message?: string }>('tunnel-status', () => {
      loadTunnels()
    })

    const unlistenError = listen<{ tunnelId: string; error: string }>('tunnel-error', (event) => {
      setError(event.payload.error)
    })

    return () => {
      unlistenCreated.then(fn => fn())
      unlistenStatus.then(fn => fn())
      unlistenError.then(fn => fn())
    }
  }, [sessionId, loadTunnels])

  // Validate port number
  const isValidPort = (port: string): boolean => {
    const num = parseInt(port)
    return !isNaN(num) && num >= 1 && num <= 65535
  }

  // Check if port is already in use by another tunnel
  const isPortInUse = (port: number, excludeId?: string): boolean => {
    return tunnels.some(t => 
      t.local_port === port && 
      t.local_host === localHost && 
      t.id !== excludeId
    )
  }

  const handleCreate = async () => {
    if (!sessionId) return
    
    // Validation
    if (!localPort) {
      setError(t('tunnel.portRequired'))
      return
    }
    
    if (!isValidPort(localPort)) {
      setError(t('tunnel.invalidPort'))
      return
    }

    const localPortNum = parseInt(localPort)
    
    if (isPortInUse(localPortNum)) {
      setError(t('tunnel.portInUse'))
      return
    }

    if (tunnelType !== 'dynamic') {
      if (!remotePort) {
        setError(t('tunnel.remotePortRequired'))
        return
      }
      if (!isValidPort(remotePort)) {
        setError(t('tunnel.invalidRemotePort'))
        return
      }
    }

    setCreating(true)
    setError('')

    try {
      await invoke('tunnel_create', {
        sessionId,
        tunnelType,
        localHost,
        localPort: localPortNum,
        remoteHost: tunnelType === 'dynamic' ? '' : remoteHost,
        remotePort: tunnelType === 'dynamic' ? 0 : parseInt(remotePort),
      })
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
      loadTunnels()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleCopy = async (tunnel: TunnelInfo) => {
    const text = `${tunnel.local_host}:${tunnel.local_port}`
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(tunnel.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (e) {
      console.error('Failed to copy:', e)
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
    // Detect service type by port
    const portCommands: Record<number, string> = {
      3306: `mysql -h ${tunnel.local_host} -P ${tunnel.local_port} -u root -p`,
      5432: `psql -h ${tunnel.local_host} -p ${tunnel.local_port} -U postgres`,
      6379: `redis-cli -h ${tunnel.local_host} -p ${tunnel.local_port}`,
      27017: `mongosh "mongodb://${tunnel.local_host}:${tunnel.local_port}"`,
    }
    return portCommands[tunnel.remote_port] || `${tunnel.local_host}:${tunnel.local_port}`
  }

  const getQuickActions = (): QuickAction[] => [
    { label: t('tunnel.quick.mysql'), remotePort: 3306, icon: '🗄', command: 'mysql -h 127.0.0.1 -P 3306 -u root -p' },
    { label: t('tunnel.quick.redis'), remotePort: 6379, icon: '⚡', command: 'redis-cli -h 127.0.0.1 -p 6379' },
    { label: t('tunnel.quick.postgres'), remotePort: 5432, icon: '🐘', command: 'psql -h 127.0.0.1 -p 5432 -U postgres' },
    { label: t('tunnel.quick.mongodb'), remotePort: 27017, icon: '🍃', command: 'mongosh "mongodb://127.0.0.1:27017"' },
  ]

  const handleQuickAction = (port: number) => {
    setTunnelType('local')
    setLocalHost('127.0.0.1')
    setLocalPort(String(port))
    setRemoteHost('127.0.0.1')
    setRemotePort(String(port))
    setShowCreate(true)
  }

  const getTunnelTypeIcon = (type: string) => {
    switch (type) {
      case 'local': return '📥'
      case 'remote': return '📤'
      case 'dynamic': return '🔄'
      default: return '🔌'
    }
  }

  if (!sessionId) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('tunnel.notConnected')}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            {t('tunnel.title')}
          </h2>
          {loading && (
            <span className="text-xs text-gray-400">{t('common.loading')}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadTunnels}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title={t('common.refresh')}
          >
            🔄
          </button>
          <button
            onClick={() => { setShowCreate(!showCreate); resetForm() }}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            {showCreate ? t('common.cancel') : t('tunnel.create')}
          </button>
        </div>
      </div>

      {/* Quick Actions - Always visible */}
      {!showCreate && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {t('tunnel.quickActions')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {getQuickActions().map(action => (
              <button
                key={action.remotePort}
                onClick={() => handleQuickAction(action.remotePort)}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
                <span className="text-gray-400 text-xs">:{action.remotePort}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
          {/* Tunnel Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('tunnel.type')}
            </label>
            <div className="flex gap-2">
              {(['local', 'remote', 'dynamic'] as TunnelType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setTunnelType(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors ${
                    tunnelType === type
                      ? 'bg-blue-500 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <span>{getTunnelTypeIcon(type)}</span>
                  <span>{t(`tunnel.types.${type}`)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Local Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('tunnel.localHost')}
              </label>
              <input
                type="text"
                value={localHost}
                onChange={e => setLocalHost(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="127.0.0.1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('tunnel.localPort')} *
              </label>
              <input
                type="number"
                value={localPort}
                onChange={e => setLocalPort(e.target.value)}
                min="1"
                max="65535"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="8080"
              />
              {localPort && !isValidPort(localPort) && (
                <p className="text-xs text-red-500 mt-1">{t('tunnel.invalidPort')}</p>
              )}
              {localPort && isValidPort(localPort) && isPortInUse(parseInt(localPort)) && (
                <p className="text-xs text-orange-500 mt-1">{t('tunnel.portInUse')}</p>
              )}
            </div>
          </div>

          {/* Remote Settings (for local/remote tunnels) */}
          {tunnelType !== 'dynamic' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('tunnel.remoteHost')}
                </label>
                <input
                  type="text"
                  value={remoteHost}
                  onChange={e => setRemoteHost(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="127.0.0.1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('tunnel.remotePort')} *
                </label>
                <input
                  type="number"
                  value={remotePort}
                  onChange={e => setRemotePort(e.target.value)}
                  min="1"
                  max="65535"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="3306"
                />
              </div>
            </div>
          )}

          {/* Description */}
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-700 p-3 rounded border-l-4 border-blue-400">
            {tunnelType === 'local' && t('tunnel.desc.local')}
            {tunnelType === 'remote' && t('tunnel.desc.remote')}
            {tunnelType === 'dynamic' && t('tunnel.desc.dynamic')}
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
              ⚠️ {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !localPort || !isValidPort(localPort) || isPortInUse(parseInt(localPort))}
              className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? t('common.creating') : t('tunnel.create')}
            </button>
            <button
              onClick={() => { setShowCreate(false); resetForm() }}
              className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Tunnel List */}
      {tunnels.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {t('tunnel.activeTunnels')} ({tunnels.length})
          </h3>
          {tunnels.map(tunnel => (
            <div
              key={tunnel.id}
              className="p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    tunnel.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                  }`} />
                  <span className="text-lg">{getTunnelTypeIcon(tunnel.tunnel_type)}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t(`tunnel.types.${tunnel.tunnel_type}`)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleCopy(tunnel)}
                    className="px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    title={t('common.copy')}
                  >
                    {copiedId === tunnel.id ? '✓' : '📋'}
                  </button>
                  <button
                    onClick={() => handleClose(tunnel.id)}
                    className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </div>
              
              {/* Connection Info */}
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <div className="font-mono bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded">
                  {getTunnelDescription(tunnel)}
                </div>
              </div>

              {/* Usage Hint */}
              {tunnel.tunnel_type !== 'remote' && (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  <span className="text-gray-500 dark:text-gray-400">💡 {t('tunnel.usageHint')}:</span>
                  <code className="ml-1 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300">
                    {getConnectionCommand(tunnel)}
                  </code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!showCreate && tunnels.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <div className="text-4xl mb-2">🔌</div>
          <p className="text-sm">{t('tunnel.empty')}</p>
          <p className="text-xs mt-2 text-gray-400">{t('tunnel.emptyHint')}</p>
        </div>
      )}
    </div>
  )
}
