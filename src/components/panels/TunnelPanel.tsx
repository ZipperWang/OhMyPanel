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
  const [error, setError] = useState('')

  const loadTunnels = useCallback(async () => {
    try {
      const result = await invoke<string>('tunnel_list')
      const allTunnels: TunnelInfo[] = JSON.parse(result)
      // Filter tunnels for current session
      setTunnels(allTunnels.filter(t => t.session_id === sessionId))
    } catch (e) {
      console.error('Failed to load tunnels:', e)
    }
  }, [sessionId])

  useEffect(() => {
    loadTunnels()

    // Listen for tunnel events
    const unlistenCreated = listen('tunnel-created', () => {
      loadTunnels()
    })

    const unlistenStatus = listen<{ tunnelId: string; status: string; message?: string }>('tunnel-status', (event) => {
      loadTunnels()
    })

    const unlistenError = listen<{ tunnelId: string; error: string }>('tunnel-error', (event) => {
      console.error('Tunnel error:', event.payload.error)
    })

    return () => {
      unlistenCreated.then(fn => fn())
      unlistenStatus.then(fn => fn())
      unlistenError.then(fn => fn())
    }
  }, [sessionId, loadTunnels])

  const handleCreate = async () => {
    if (!sessionId) return
    if (!localPort) {
      setError(t('tunnel.portRequired'))
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

  const getQuickActions = () => [
    { label: t('tunnel.quick.mysql'), remotePort: 3306, icon: '🗄' },
    { label: t('tunnel.quick.redis'), remotePort: 6379, icon: '⚡' },
    { label: t('tunnel.quick.postgres'), remotePort: 5432, icon: '🐘' },
    { label: t('tunnel.quick.mongodb'), remotePort: 27017, icon: '🍃' },
  ]

  const handleQuickAction = (port: number) => {
    setTunnelType('local')
    setLocalHost('127.0.0.1')
    setLocalPort(String(port))
    setRemoteHost('127.0.0.1')
    setRemotePort(String(port))
    setShowCreate(true)
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
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
          {t('tunnel.title')}
        </h2>
        <button
          onClick={() => { setShowCreate(!showCreate); resetForm() }}
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          {showCreate ? t('common.cancel') : t('tunnel.create')}
        </button>
      </div>

      {/* Quick Actions */}
      {!showCreate && tunnels.length === 0 && (
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
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    tunnelType === type
                      ? 'bg-blue-500 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  {t(`tunnel.types.${type}`)}
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
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="8080"
              />
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
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="3306"
                />
              </div>
            </div>
          )}

          {/* Description */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {tunnelType === 'local' && t('tunnel.desc.local')}
            {tunnelType === 'remote' && t('tunnel.desc.remote')}
            {tunnelType === 'dynamic' && t('tunnel.desc.dynamic')}
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-500">{error}</div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
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
              className="flex items-center justify-between p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    tunnel.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
                  }`} />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t(`tunnel.types.${tunnel.tunnel_type}`)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {getTunnelDescription(tunnel)}
                </div>
              </div>
              <button
                onClick={() => handleClose(tunnel.id)}
                className="ml-3 px-3 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!showCreate && tunnels.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <div className="text-4xl mb-2">🔌</div>
          <p className="text-sm">{t('tunnel.empty')}</p>
        </div>
      )}
    </div>
  )
}
