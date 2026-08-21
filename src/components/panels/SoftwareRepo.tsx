import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'

interface SoftwareInfo {
  name: string
  display_name: string
  category: string
  installed: boolean
  version: string
  service_name: string
  running: boolean
}

interface SoftwareRepoProps {
  sessionId: string | null
}

type PanelState = 'loading' | 'ready' | 'error' | 'running'
type LogStatus = 'running' | 'done' | 'error'

interface ConfirmAction {
  software: SoftwareInfo
  action: 'install' | 'uninstall'
}

interface MysqlVariant {
  variant: string
  version: string
}

export default function SoftwareRepo({ sessionId }: SoftwareRepoProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<PanelState>('loading')
  const [software, setSoftware] = useState<SoftwareInfo[]>([])
  const [error, setError] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logStatus, setLogStatus] = useState<LogStatus | null>(null)
  const [rawOutput, setRawOutput] = useState('')
  const [actionLabel, setActionLabel] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 配置编辑器状态
  const [configEditorOpen, setConfigEditorOpen] = useState(false)
  const [configEditorContent, setConfigEditorContent] = useState('')
  const [configEditorLoading, setConfigEditorLoading] = useState(false)
  const [configEditorSaving, setConfigEditorSaving] = useState(false)
  const [configEditorTitle, setConfigEditorTitle] = useState('')
  const [configEditorMaximized, setConfigEditorMaximized] = useState(false)
  const [configEditorPath, setConfigEditorPath] = useState('')

  // ponytail：已移除所有版本选择器，由系统包管理器处理版本

  // PHP 版本选择弹窗状态
  const [phpVersionModalOpen, setPhpVersionModalOpen] = useState(false)
  const [sourceCompile] = useState(false)
  const [dockerSourceModal, setDockerSourceModal] = useState<SoftwareInfo | null>(null)
  const [dockerSourceSelected, setDockerSourceSelected] = useState<'official' | 'aliyun'>('official')
  const [availableVersions, setAvailableVersions] = useState<string[]>([])
  const [selectedVersion, setSelectedVersion] = useState('')
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState('')

  // MySQL 版本选择弹窗状态
  const [mysqlVersionModalOpen, setMysqlVersionModalOpen] = useState(false)
  const [availableMysqlVersions, setAvailableMysqlVersions] = useState<MysqlVariant[]>([])
  const [selectedMysqlVersion, setSelectedMysqlVersion] = useState('')
  const [mysqlVersionsLoading, setMysqlVersionsLoading] = useState(false)
  const [mysqlVersionsError, setMysqlVersionsError] = useState('')

  // 软件包源管理状态
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false)
  const [removableSources, setRemovableSources] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState('')
  const [cleaningSources, setCleaningSources] = useState(false)
  const [cleanLogs, setCleanLogs] = useState<string[]>([])
  const [cleanLogStatus, setCleanLogStatus] = useState<'running' | 'done' | 'error' | null>(null)

  // 添加软件包源弹窗状态
  const [addSourceModalOpen, setAddSourceModalOpen] = useState(false)
  const [addSourceName, setAddSourceName] = useState('')
  const [addSourceUrl, setAddSourceUrl] = useState('')
  const [addSourceGpgKey, setAddSourceGpgKey] = useState('')
  const [addSourceLoading, setAddSourceLoading] = useState(false)
  const [addSourceError, setAddSourceError] = useState('')

  // 自定义软件状态
  const [customSoftware, setCustomSoftware] = useState<SoftwareInfo[]>([])
  const [addCustomModalOpen, setAddCustomModalOpen] = useState(false)
  const [addCustomName, setAddCustomName] = useState('')
  const [addCustomDisplay, setAddCustomDisplay] = useState('')
  const [addCustomCategory, setAddCustomCategory] = useState('other')
  const [addCustomLoading, setAddCustomLoading] = useState(false)
  const [addCustomError, setAddCustomError] = useState('')
  const [customConfirmAction, setCustomConfirmAction] = useState<{ sw: SoftwareInfo; action: 'install' | 'uninstall' | 'remove' } | null>(null)

  const loadCustomSoftware = async () => {
    if (!sessionId) return
    try {
      const list = await invoke<SoftwareInfo[]>('custom_software_list', { sessionId })
      setCustomSoftware(list)
    } catch {
      // ponytail：静默忽略，自定义软件属于补充功能
    }
  }

  const loadSoftware = async () => {
    if (!sessionId) return
    // ponytail：这里不设置 state 为 'loading'，重新加载期间保留旧数据以避免闪烁
    setError('')
    try {
      const list = await invoke<SoftwareInfo[]>('server_get_software_list', { sessionId })
      setSoftware(list)
      setState('ready')
    } catch (e) {
      setError(String(e))
      setState('error')
    }
    loadCustomSoftware()
  }

  // ponytail：用于恢复安装的轮询函数
  const startPolling = () => {
    if (pollingRef.current) return
    let pollErrors = 0
    pollingRef.current = setInterval(async () => {
      if (!sessionId) return
      try {
        const result = await invoke<{ running: boolean; log: string; action: string; displayName: string }>('server_check_installation', { sessionId })
        pollErrors = 0
        if (result.running) {
          const lines = result.log.split('\n').filter(l => l.trim())
          setLogs(lines)
        } else {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
          // ponytail：安装完成时显示最终日志
          if (result.log) {
            setLogs(result.log.split('\n').filter(l => l.trim()))
          }
          setLogs(prev => [...prev, 'Installation process ended'])
          setLogStatus('done')
          // ponytail：恢复完成时更新 actionLabel
          const actionText = result.action === 'install' ? 'Installed' : 'Uninstalled'
          setActionLabel(result.displayName ? `${actionText} ${result.displayName}` : 'Completed')
          // ponytail：这里不调用 loadSoftware()，让用户点击“完成 - 刷新”按钮
        }
      } catch {
        pollErrors++
        if (pollErrors >= 3) {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
          setLogs(prev => [...prev, 'Connection lost during recovery, please check manually'])
          setLogStatus('error')
          setActionLabel('Connection lost')
        }
      }
    }, 3000)
  }

  useEffect(() => {
    if (!sessionId) return
    // 加载软件列表前检查是否有正在运行的安装
    invoke<{ running: boolean; log: string; action: string; displayName: string }>('server_check_installation', { sessionId })
      .then(result => {
        if (result.running) {
          if (result.log) {
            setLogs(result.log.split('\n').filter(l => l.trim()))
          } else {
            setLogs([t('software.recoveringProgress')])
          }
          setLogStatus('running')
          // ponytail：根据恢复的 action/displayName 信息构建 actionLabel
          const actionText = result.action === 'install' ? 'Installing' : 'Uninstalling'
          setActionLabel(result.displayName ? `${actionText} ${result.displayName}...` : t('software.recoveringProgress'))
          setState('running')
          startPolling()
        } else {
          loadSoftware()
        }
      })
      .catch(() => { loadSoftware() })
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    }
  }, [sessionId])

  // 监听进度事件
  useEffect(() => {
    if (!sessionId) return
    const unlisten = listen<{ sessionId: string; line: string; status: string }>(
      'software-action-progress',
      (event) => {
        if (event.payload.sessionId !== sessionId) return
        setLogs(prev => [...prev, event.payload.line])
        if (event.payload.status === 'done') {
          setLogStatus('done')
        } else if (event.payload.status === 'error') {
          setLogStatus('error')
        }
      }
    )
    return () => { unlisten.then(fn => fn()) }
  }, [sessionId])

  // 监听原始终端输出
  useEffect(() => {
    if (!sessionId) return
    const unlisten = listen<{ sessionId: string; rawOutput: string }>(
      'software-action-raw-output',
      (event) => {
        if (event.payload.sessionId !== sessionId) return
        setRawOutput(event.payload.rawOutput)
      }
    )
    return () => { unlisten.then(fn => fn()) }
  }, [sessionId])

  // 监听软件包源操作进度事件
  useEffect(() => {
    if (!sessionId) return
    const unlisten = listen<{ sessionId: string; line: string; status: string }>(
      'sources-action-progress',
      (event) => {
        if (event.payload.sessionId !== sessionId) return
        setCleanLogs(prev => [...prev, event.payload.line])
        if (event.payload.status === 'done') {
          setCleanLogStatus('done')
        } else if (event.payload.status === 'error') {
          setCleanLogStatus('error')
        }
      }
    )
    return () => { unlisten.then(fn => fn()) }
  }, [sessionId])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleAction = async (sw: SoftwareInfo, action: 'install' | 'uninstall', options = '') => {
    if (!sessionId) return
    let opts = options
    // ponytail：调用方传入的选项（例如 Docker 源、PHP 版本）
    setState('running')
    setLogs([`${action === 'install' ? 'Installing' : 'Uninstalling'} ${sw.display_name}...`])
    setLogStatus('running')
    setActionLabel(`${action === 'install' ? 'Installing' : 'Uninstalling'} ${sw.display_name}`)

    try {
      await invoke('server_software_action', {
        sessionId,
        software: sw.name,
        action,
        options: opts,
        displayName: sw.display_name,
      })
      setLogStatus('done')
    } catch (e) {
      const msg = String(e)
      setLogs(prev => [...prev, msg.length > 300 ? msg.slice(0, 300) + '...' : msg])
      setLogStatus('error')
    }
  }

  const handleServiceAction = async (sw: SoftwareInfo, action: string) => {
    if (!sessionId || !sw.service_name) return
    try {
      await invoke('server_service_action', { sessionId, service: sw.service_name, action })
      setTimeout(loadSoftware, 1000)
    } catch (e) {
      setError(`${action} failed: ${e}`)
    }
  }

  const handlePHPInstallClick = async () => {
    if (!sessionId) return
    setVersionsLoading(true)
    setVersionsError('')
    setPhpVersionModalOpen(true)
    try {
      const versions = await invoke<string[]>('server_get_available_php_versions', { sessionId })
      setAvailableVersions(versions)
      if (versions.length === 0) {
        setVersionsError(t('software.noVersionsAvailable'))
      } else {
        setSelectedVersion(versions[versions.length - 1]) // 默认选择最新版本
      }
    } catch (e) {
      setVersionsError(`${t('software.queryFailed')}: ${String(e)}`)
    } finally {
      setVersionsLoading(false)
    }
  }

  // 加载可移除的软件包源
  const handleManageSourcesClick = async () => {
    if (!sessionId) return
    setSourcesLoading(true)
    setSourcesError('')
    setSourcesModalOpen(true)
    try {
      const sources = await invoke<string[]>('server_get_removable_sources', { sessionId })
      setRemovableSources(sources)
      setSelectedSources([])
    } catch (e) {
      setSourcesError(`${t('software.queryFailed')}: ${String(e)}`)
    } finally {
      setSourcesLoading(false)
    }
  }

  // 移除选中的软件包源
  const handleRemoveSelectedSources = async () => {
    if (!sessionId || selectedSources.length === 0) return
    try {
      await invoke<string>('server_remove_sources', {
        sessionId,
        sourceNames: selectedSources,
      })
      setSourcesModalOpen(false)
      setTimeout(() => handleManageSourcesClick(), 500)
    } catch (e) {
      setSourcesError(`${t('software.queryFailed')}: ${String(e)}`)
    }
  }

  // 添加新的软件包源
  const handleAddSource = async () => {
    if (!sessionId || !addSourceName.trim() || !addSourceUrl.trim()) return
    setAddSourceLoading(true)
    setAddSourceError('')
    try {
      await invoke<string>('server_add_source', {
        sessionId,
        name: addSourceName.trim(),
        url: addSourceUrl.trim(),
        gpgKey: addSourceGpgKey.trim() || null,
      })
      setAddSourceModalOpen(false)
      setAddSourceName('')
      setAddSourceUrl('')
      setAddSourceGpgKey('')
    } catch (e) {
      setAddSourceError(String(e).slice(0, 300))
    } finally {
      setAddSourceLoading(false)
    }
  }

  // 清理并更新软件包源
  const handleCleanAndUpdateSources = async () => {
    if (!sessionId) return
    setCleaningSources(true)
    setCleanLogs([t('software.cleaningSources')])
    setCleanLogStatus('running')
    try {
      await invoke('server_clean_and_update_sources', { sessionId })
      setCleanLogStatus('done')
    } catch (e) {
      const msg = String(e)
      setCleanLogs(prev => [...prev, msg.length > 300 ? msg.slice(0, 300) + '...' : msg])
      setCleanLogStatus('error')
    }
  }

  const handleConfirmPHPInstall = async () => {
    if (!sessionId || !selectedVersion) return
    setPhpVersionModalOpen(false)
    // ponytail：源码编译模式将 "source:X.Y" 作为 options 传递
    const opts = sourceCompile ? `source:${selectedVersion}` : selectedVersion
    setState('running')
    setLogs([`${sourceCompile ? t('software.compilingPHPSource', { version: selectedVersion }) : t('software.installingPHPVersion', { version: selectedVersion })}`])
    setLogStatus('running')
    setActionLabel(`${sourceCompile ? t('software.compilingPHPSource', { version: selectedVersion }) : t('software.installingPHPVersion', { version: selectedVersion })}`)
    try {
      await invoke('server_software_action', {
        sessionId,
        software: 'php',
        action: 'install',
        options: opts,
        displayName: `PHP ${selectedVersion}`,
      })
      setLogStatus('done')
    } catch (e) {
      const msg = String(e)
      setLogs(prev => [...prev, msg.length > 300 ? msg.slice(0, 300) + '...' : msg])
      setLogStatus('error')
    }
  }

  const handleMySQLInstallClick = async () => {
    if (!sessionId) return
    setMysqlVersionsLoading(true)
    setMysqlVersionsError('')
    setMysqlVersionModalOpen(true)
    try {
      const versions = await invoke<MysqlVariant[]>('server_get_available_mysql_versions', { sessionId })
      setAvailableMysqlVersions(versions)
      if (versions.length === 0) {
        setMysqlVersionsError(t('software.noMysqlVersionsAvailable'))
      } else {
        // 如果可用则默认选择 mariadb，否则选择第一个可用项
        const mariadb = versions.find(v => v.variant === 'mariadb')
        setSelectedMysqlVersion(mariadb ? mariadb.variant : versions[0].variant)
      }
    } catch (e) {
      setMysqlVersionsError(`${t('software.queryFailed')}: ${String(e)}`)
    } finally {
      setMysqlVersionsLoading(false)
    }
  }

  const handleConfirmMySQLInstall = async () => {
    if (!sessionId || !selectedMysqlVersion) return
    setMysqlVersionModalOpen(false)
    const selected = availableMysqlVersions.find(v => v.variant === selectedMysqlVersion)
    const displayName = selectedMysqlVersion === 'mysql' ? 'MySQL' : 'MariaDB'
    const versionStr = selected?.version || ''
    setState('running')
    setLogs([t('software.installingMysqlVersion', { version: `${displayName} ${versionStr}` })])
    setLogStatus('running')
    setActionLabel(t('software.installingMysqlVersion', { version: `${displayName} ${versionStr}` }))
    try {
      await invoke('server_software_action', {
        sessionId,
        software: 'mysql',
        action: 'install',
        options: selectedMysqlVersion,
        displayName: `${displayName} ${versionStr}`,
      })
      setLogStatus('done')
    } catch (e) {
      const msg = String(e)
      setLogs(prev => [...prev, msg.length > 300 ? msg.slice(0, 300) + '...' : msg])
      setLogStatus('error')
    }
  }

  const handleAddCustomSoftware = async () => {
    if (!sessionId || !addCustomName.trim()) return
    setAddCustomLoading(true)
    setAddCustomError('')
    try {
      const displayName = addCustomDisplay.trim() || addCustomName.trim()
      await invoke('custom_software_add', {
        sessionId,
        packageName: addCustomName.trim(),
        displayName,
        category: addCustomCategory,
      })
      setAddCustomModalOpen(false)
      setAddCustomName('')
      setAddCustomDisplay('')
      setAddCustomCategory('other')
      loadCustomSoftware()
    } catch (e) {
      setAddCustomError(String(e).slice(0, 300))
    } finally {
      setAddCustomLoading(false)
    }
  }

  const handleRemoveCustomTracking = async (packageName: string) => {
    if (!sessionId) return
    try {
      await invoke('custom_software_remove', { sessionId, packageName })
      loadCustomSoftware()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleCustomAction = async (sw: SoftwareInfo, action: 'install' | 'uninstall') => {
    if (!sessionId) return
    setState('running')
    setLogs([`${action === 'install' ? 'Installing' : 'Uninstalling'} ${sw.display_name}...`])
    setLogStatus('running')
    setActionLabel(`${action === 'install' ? 'Installing' : 'Uninstalling'} ${sw.display_name}`)
    try {
      await invoke('custom_software_action', {
        sessionId,
        packageName: sw.name,
        action,
        displayName: sw.display_name,
      })
      setLogStatus('done')
    } catch (e) {
      const msg = String(e)
      setLogs(prev => [...prev, msg.length > 300 ? msg.slice(0, 300) + '...' : msg])
      setLogStatus('error')
    }
  }

  const getConfigPath = (sw: SoftwareInfo): string => {
    // ponytail：各软件的配置文件路径
    switch (sw.name) {
      case 'nginx': return '/etc/nginx/nginx.conf'
      case 'mysql': return '/etc/mysql/my.cnf'
      case 'postgresql': return `/etc/postgresql/${sw.version}/main/postgresql.conf`
      case 'redis': return '/etc/redis/redis.conf'
      case 'memcached': return '/etc/memcached.conf'
      case 'docker': return '/etc/docker/daemon.json'
      default:
        if (sw.name.startsWith('php')) {
          const ver = sw.name.replace('php', '')
          return `/etc/php/${ver}/fpm/pool.d/www.conf`
        }
        if (sw.name.startsWith('apache')) return '/etc/apache2/apache2.conf'
        return ''
    }
  }

  const handleEditConfig = async (sw: SoftwareInfo) => {
    if (!sessionId) return
    const configPath = getConfigPath(sw)
    if (!configPath) return
    setConfigEditorPath(configPath)
    setConfigEditorTitle(sw.display_name)
    setConfigEditorOpen(true)
    setConfigEditorLoading(true)
    try {
      const text = await invoke<string>('server_read_remote_file', {
        sessionId,
        path: configPath,
      })
      setConfigEditorContent(text)
    } catch (e) {
      setError(String(e))
      setConfigEditorOpen(false)
    } finally {
      setConfigEditorLoading(false)
    }
  }

  const handleSaveConfig = async () => {
    if (!sessionId) return
    setConfigEditorSaving(true)
    try {
      await invoke('server_write_remote_file', {
        sessionId,
        path: configEditorPath,
        content: configEditorContent,
      })
      setConfigEditorOpen(false)
      // 重新加载软件列表以反映变化
      setTimeout(loadSoftware, 500)
    } catch (e) {
      setError(String(e))
    } finally {
      setConfigEditorSaving(false)
    }
  }

  if (!sessionId) {
    return <div className="sp-empty">{t('software.connectToManage')}</div>
  }

  const categories = [
    { key: 'web', label: t('software.webServer') },
    // ponytail：恢复数据库分类（仅移除 MySQL/MariaDB，保留 Redis/PostgreSQL/Memcached）
    { key: 'database', label: t('software.database') },
    { key: 'runtime', label: t('software.runtime') },
    { key: 'tools', label: t('software.tools') },
    { key: 'container', label: t('software.container') },
    { key: 'custom', label: t('software.customCategory') },
  ]

  return (
    <div className="sw-panel">
      <div className="sw-header">
        <h2>{t('software.title')}</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {state === 'running' && (
            <button className="sw-action-btn primary" onClick={() => { setState('ready'); setLogs([]); setLogStatus(null); setRawOutput(''); loadSoftware() }}>
              ← {t('common.back', 'Back')}
            </button>
          )}
          <button className="sw-action-btn small primary" onClick={() => { setAddCustomModalOpen(true); setAddCustomError('') }} disabled={state === 'running'}>
            + {t('software.addCustomSoftware')}
          </button>
          <button className="sp-refresh-btn" onClick={loadSoftware} disabled={state === 'loading' || state === 'running'}>
            {state === 'loading' ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div className="svc-error">{error}</div>
      )}

      {state === 'loading' && software.length === 0 && (
        <div className="sp-loading">{t('software.checkingStatus')}</div>
      )}

      {state === 'error' && software.length === 0 && (
        <div className="sp-error">
          <p>Failed to load: {error}</p>
          <button className="sp-retry-btn" onClick={loadSoftware}>Retry</button>
        </div>
      )}

      {/* 运行状态 - 显示日志 */}
      {state === 'running' && (
        <div className="sw-running">
          <div className="sw-running-header">
            <div className={`sw-running-status ${logStatus}`}>
              {logStatus === 'running' && <div className="sw-spinner" />}
              {logStatus === 'done' && <span className="sw-done-icon">✓</span>}
              {logStatus === 'error' && <span className="sw-error-icon">✗</span>}
              <span>{actionLabel}</span>
            </div>
          </div>
          <div className="sw-log-box">
            {logs.map((line, i) => {
              // 确定日志行类型以应用样式
              const isError = line.includes('ERROR') || line.includes('failed') || line.startsWith('E:') || line.includes('fatal')
              const isCommand = line.startsWith('Executing:') || line.startsWith('Script preview:')
              const isSuccess = line.includes('ACTION_SUCCESS') || line.includes('completed successfully')
              const isSeparator = line.includes('━━━')
              const isKeyError = line.startsWith('Key errors found') || line.startsWith('   ')
              const isPkgLock = line.includes('Waiting for package manager lock')
              
              let lineClass = 'sw-log-line'
              if (isSeparator) lineClass += ' separator'
              else if (isCommand) lineClass += ' command'
              else if (isSuccess) lineClass += ' success'
              else if (isKeyError) lineClass += ' key-error'
              else if (isError) lineClass += ' error'
              
              return (
                <div key={i} className={lineClass}>
                  {line}{isPkgLock ? ` — ${t('software.pkgLockHint')}` : ''}
                </div>
              )
            })}
            <div ref={logEndRef} />
          </div>
          
          {/* 原始终端输出折叠区域 */}
          {logStatus === 'error' && (
            <details className="sw-error-details">
              <summary className="sw-error-details-summary">
                 {t('software.viewFullOutput')}
              </summary>
              <pre className="sw-error-details-content">
                {rawOutput || logs.join('\n')}
              </pre>
            </details>
          )}
          
          {logStatus === 'done' && (
            <button className="sw-action-btn primary" onClick={() => { setState('ready'); setRawOutput(''); loadSoftware() }}>
              {t('software.doneRefresh')}
            </button>
          )}
          {logStatus === 'error' && (
            <button className="sw-action-btn" onClick={() => { setState('ready'); setRawOutput(''); loadSoftware() }}>
              {t('common.close')}
            </button>
          )}
        </div>
      )}

      {/* 软件包源管理卡片 */}
      {(state === 'ready' || state === 'error') && (
        <div className="sw-sources-card">
          <div className="sw-sources-header">
            <h3>{t('software.packageSourcesTitle')}</h3>
          </div>
          <div className="sw-sources-actions">
            <button
              className="sw-action-btn small primary"
              onClick={handleCleanAndUpdateSources}
              disabled={cleaningSources}
            >
              {cleaningSources ? t('software.updatingSources') : t('software.cleanSources')}
            </button>
          </div>
        </div>
      )}

      {/* 清理软件包源进度 */}
      {cleaningSources && (
        <div className="sw-running" style={{ marginTop: '16px', marginBottom: '16px' }}>
          <div className="sw-running-header">
            <div className={`sw-running-status ${cleanLogStatus}`}>
              {cleanLogStatus === 'running' && <div className="sw-spinner" />}
              {cleanLogStatus === 'done' && <span className="sw-done-icon">✓</span>}
              {cleanLogStatus === 'error' && <span className="sw-error-icon">✗</span>}
              <span>{t('software.cleaningSources')}</span>
            </div>
          </div>
          <div className="sw-log-box">
            {cleanLogs.map((line, i) => (
              <div key={i} className={`sw-log-line ${line.includes('ERROR') || line.includes('failed') ? 'error' : ''}`}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
          {(cleanLogStatus === 'done' || cleanLogStatus === 'error') && (
            <button
              className="sw-action-btn"
              onClick={() => { setCleaningSources(false); setCleanLogs([]); setCleanLogStatus(null); }}
            >
              {t('common.close')}
            </button>
          )}
        </div>
      )}

      {/* 软件网格 */}
      {(state === 'ready' || state === 'error') && software.length > 0 && (
        <div className="sw-categories">
          {categories.map(cat => {
            const items = cat.key === 'custom'
              ? customSoftware
              : software.filter(s => s.category === cat.key)
            if (items.length === 0 && cat.key !== 'web' && cat.key !== 'custom') return null
            if (cat.key === 'custom' && items.length === 0) return null
            return (
              <div key={cat.key} className="sw-category">
                <div className="sw-category-title">{cat.label}</div>
                <div className="sw-grid">
                  {items.map(sw => (
                    <div key={sw.name} className={`sw-card ${sw.installed ? 'installed' : ''}`}>
                      <div className="sw-card-header">
                        <span className="sw-card-name">{sw.display_name}</span>
                        <span className={`sw-status-dot ${sw.running ? 'running' : sw.installed ? 'stopped' : ''}`} />
                      </div>

                      <div className="sw-card-info">
                        {sw.installed ? (
                          <>
                            <span className="sw-version">{sw.name === 'php' ? (sw.version || t('software.installMultiplePHP')) : (sw.version || t('software.installed'))}</span>
                            <span className={`sw-state-label ${sw.running ? 'running' : 'stopped'}`}>
                              {sw.running ? t('software.runningLabel') : sw.service_name ? t('software.stoppedLabel') : t('software.installedLabel')}
                            </span>
                          </>
                        ) : (
                          <span className="sw-not-installed">{t('software.notInstalledLabel')}</span>
                        )}
                      </div>

                      <div className="sw-card-actions">
                        {cat.key === 'custom' ? (
                          <>
                            {sw.installed && sw.service_name && (
                              <>
                                <button className="sw-action-btn small" onClick={() => handleServiceAction(sw, 'start')} disabled={sw.running}>{t('common.start')}</button>
                                <button className="sw-action-btn small" onClick={() => handleServiceAction(sw, 'stop')} disabled={!sw.running}>{t('common.stop')}</button>
                                <button className="sw-action-btn small" onClick={() => handleServiceAction(sw, 'restart')} disabled={!sw.running}>{t('common.restart')}</button>
                              </>
                            )}
                            {sw.installed ? (
                              <>
                                <button className="sw-action-btn small danger" onClick={() => setCustomConfirmAction({ sw, action: 'uninstall' })}>{t('common.uninstall')}</button>
                                <button className="sw-action-btn small" onClick={() => setCustomConfirmAction({ sw, action: 'remove' })} title={t('software.removeFromList')}>✕</button>
                              </>
                            ) : (
                              <>
                                <button className="sw-action-btn small primary" onClick={() => setCustomConfirmAction({ sw, action: 'install' })}>{t('common.install')}</button>
                                <button className="sw-action-btn small" onClick={() => setCustomConfirmAction({ sw, action: 'remove' })} title={t('software.removeFromList')}>✕</button>
                              </>
                            )}
                          </>
                        ) : sw.installed ? (
                          <>
                            {sw.service_name && (
                              <>
                                <button
                                  className="sw-action-btn small"
                                  onClick={() => handleServiceAction(sw, 'start')}
                                  disabled={sw.running}
                                >{t('common.start')}</button>
                                <button
                                  className="sw-action-btn small"
                                  onClick={() => handleServiceAction(sw, 'stop')}
                                  disabled={!sw.running}
                                >{t('common.stop')}</button>
                                <button
                                  className="sw-action-btn small"
                                  onClick={() => handleServiceAction(sw, 'restart')}
                                  disabled={!sw.running}
                                >{t('common.restart')}</button>
                              </>
                            )}
                            {sw.name === 'php' && (
                              <button
                                className="sw-action-btn small primary"
                                onClick={() => handlePHPInstallClick()}
                              >{t('software.installMore')}</button>
                            )}
                            {getConfigPath(sw) && (
                              <button
                                className="sw-action-btn small"
                                onClick={() => handleEditConfig(sw)}
                              >{t('software.configLabel')}</button>
                            )}
                            <button
                              className="sw-action-btn small danger"
                              onClick={() => setConfirmAction({ software: sw, action: 'uninstall' })}
                            >{t('common.uninstall')}</button>
                          </>
                        ) : (
                          sw.name === 'php' ? (
                            <button
                              className="sw-action-btn small primary"
                              onClick={() => handlePHPInstallClick()}
                              disabled={versionsLoading}
                            >{versionsLoading && phpVersionModalOpen ? t('software.queryingVersions') : t('common.install')}</button>
                          ) : (
                            <button
                              className="sw-action-btn small primary"
                              onClick={() => {
                                if (sw.name === 'docker') {
                                  setDockerSourceModal(sw)
                                } else if (sw.name === 'mysql') {
                                  handleMySQLInstallClick()
                                } else {
                                  setConfirmAction({ software: sw, action: 'install' })
                                }
                              }}
                              disabled={mysqlVersionsLoading && mysqlVersionModalOpen}
                            >{(mysqlVersionsLoading && mysqlVersionModalOpen) ? t('software.queryingVersions') : t('common.install')}</button>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                  {/* ponytail：已移除“安装 PHP 版本”卡片 */}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 确认对话框 */}
      {confirmAction && (
        <div className="sw-confirm-overlay" onClick={() => setConfirmAction(null)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">
              {confirmAction.action === 'install' ? t('software.installTitle', { name: confirmAction.software.display_name }) : t('software.uninstallTitle', { name: confirmAction.software.display_name })}
            </div>



            {confirmAction.action === 'uninstall' && (
              <div className="sw-confirm-warning">
                This will remove {confirmAction.software.display_name} and its configuration from the server.
              </div>
            )}

            <div className="sw-confirm-actions">
              <button className="sw-action-btn" onClick={() => setConfirmAction(null)}>{t('common.cancel')}</button>
              <button
                className={`sw-action-btn ${confirmAction.action === 'uninstall' ? 'danger' : 'primary'}`}
                onClick={() => {
                  handleAction(confirmAction.software, confirmAction.action)
                  setConfirmAction(null)
                }}
              >
                {confirmAction.action === 'install' ? t('common.install') : t('common.uninstall')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PHP 版本选择弹窗 */}
      {phpVersionModalOpen && (
        <div className="sw-confirm-overlay" onClick={() => setPhpVersionModalOpen(false)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">{t('software.selectPHPVersion')}</div>

            {versionsLoading ? (
              <div style={{ padding: '16px', textAlign: 'center' }}>{t('software.queryingVersions')}</div>
            ) : versionsError ? (
              <div className="sw-confirm-warning" style={{ color: 'var(--red)' }}>{versionsError}</div>
            ) : (
              <>
                {/* 安装方式切换，ponytail：隐藏源码编译，仅支持软件包安装 */}
                <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
                  <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--green-bg)', background: 'rgba(35,134,54,0.1)', cursor: 'pointer' }}>
                    <input type="radio" name="phpInstallMethod" checked readOnly />
                    <span style={{ fontSize: '13px' }}>{t('software.installMethodPackage')}</span>
                  </label>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                    {t('software.availableVersionsLabel')}:
                  </label>
                  <select
                    value={selectedVersion}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      fontSize: '14px',
                      background: 'var(--bg-panel)',
                      color: 'var(--text)',
                    }}
                  >
                    {availableVersions.map(ver => (
                      <option key={ver} value={ver}>
                        PHP {ver}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sw-confirm-warning">
                  {t('software.installPHPVersionWarning', { version: selectedVersion })}
                </div>
              </>
            )}

            <div className="sw-confirm-actions">
              <button
                className="sw-action-btn"
                onClick={() => setPhpVersionModalOpen(false)}
                disabled={versionsLoading}
              >{t('common.cancel')}</button>
              <button
                className="sw-action-btn primary"
                onClick={handleConfirmPHPInstall}
                disabled={versionsLoading || !!versionsError || !selectedVersion}
              >{sourceCompile ? t('software.compilePHPVersion', { version: selectedVersion }) : t('software.installPHPVersion', { version: selectedVersion })}</button>
            </div>
          </div>
        </div>
      )}

      {/* MySQL 版本选择弹窗 */}
      {mysqlVersionModalOpen && (
        <div className="sw-confirm-overlay" onClick={() => setMysqlVersionModalOpen(false)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">{t('software.selectMysqlVersion')}</div>

            {mysqlVersionsLoading ? (
              <div style={{ padding: '16px', textAlign: 'center' }}>{t('software.queryingVersions')}</div>
            ) : mysqlVersionsError ? (
              <div className="sw-confirm-warning" style={{ color: 'var(--red)' }}>{mysqlVersionsError}</div>
            ) : (
              <>
                <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {availableMysqlVersions.map(v => (
                    <label
                      key={v.variant}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer',
                        padding: '12px 14px', borderRadius: '8px',
                        border: `1px solid ${selectedMysqlVersion === v.variant ? 'var(--green-bg)' : 'var(--border)'}`,
                        background: selectedMysqlVersion === v.variant ? 'rgba(35,134,54,0.1)' : 'transparent',
                      }}
                    >
                      <input
                        type="radio"
                        name="mysqlVersion"
                        checked={selectedMysqlVersion === v.variant}
                        onChange={() => setSelectedMysqlVersion(v.variant)}
                        style={{ marginTop: '3px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                          {v.variant === 'mysql' ? t('software.mysqlLabel') : t('software.mariadbLabel')}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          {v.variant === 'mysql' ? t('software.mysqlDesc') : t('software.mariadbDesc')}
                        </div>
                        {v.version && (
                          <div style={{ fontSize: '12px', color: 'var(--accent)' }}>
                            {t('software.mysqlVersionInfo', { version: v.version })}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                <div className="sw-confirm-warning">
                  {t('software.installMysqlVersionWarning', { version: selectedMysqlVersion === 'mysql' ? 'MySQL' : 'MariaDB' })}
                </div>
              </>
            )}

            <div className="sw-confirm-actions">
              <button
                className="sw-action-btn"
                onClick={() => setMysqlVersionModalOpen(false)}
                disabled={mysqlVersionsLoading}
              >{t('common.cancel')}</button>
              <button
                className="sw-action-btn primary"
                onClick={handleConfirmMySQLInstall}
                disabled={mysqlVersionsLoading || !!mysqlVersionsError || !selectedMysqlVersion}
              >{t('software.installMysqlVersion', { version: selectedMysqlVersion === 'mysql' ? 'MySQL' : 'MariaDB' })}</button>
            </div>
          </div>
        </div>
      )}

      {/* Docker 源选择弹窗 */}
      {dockerSourceModal && (
        <div className="sw-confirm-overlay" onClick={() => setDockerSourceModal(null)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">{t('software.dockerSourceTitle')}</div>
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${dockerSourceSelected === 'official' ? 'var(--green-bg)' : 'var(--border)'}`, background: dockerSourceSelected === 'official' ? 'rgba(35,134,54,0.1)' : 'transparent' }}>
                <input type="radio" name="dockerSource" checked={dockerSourceSelected === 'official'} onChange={() => setDockerSourceSelected('official')} />
                {t('software.dockerSourceOfficial')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${dockerSourceSelected === 'aliyun' ? 'var(--green-bg)' : 'var(--border)'}`, background: dockerSourceSelected === 'aliyun' ? 'rgba(35,134,54,0.1)' : 'transparent' }}>
                <input type="radio" name="dockerSource" checked={dockerSourceSelected === 'aliyun'} onChange={() => setDockerSourceSelected('aliyun')} />
                {t('software.dockerSourceAliyun')}
              </label>
            </div>
            <div className="sw-confirm-actions">
              <button className="sw-action-btn" onClick={() => setDockerSourceModal(null)}>{t('common.cancel')}</button>
              <button
                className="sw-action-btn primary"
                onClick={() => {
                  handleAction(dockerSourceModal, 'install', dockerSourceSelected)
                  setDockerSourceModal(null)
                }}
              >
                {t('software.install')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 管理软件包源弹窗 */}
      {sourcesModalOpen && (
        <div className="sw-confirm-overlay" onClick={() => setSourcesModalOpen(false)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">{t('software.removableSources')}</div>

            {sourcesLoading ? (
              <div style={{ padding: '16px', textAlign: 'center' }}>{t('software.loadingSources')}</div>
            ) : sourcesError ? (
              <div className="sw-confirm-warning" style={{ color: 'var(--red)' }}>{sourcesError}</div>
            ) : removableSources.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center' }}>{t('software.noOldSources')}</div>
            ) : (
              <>
                <div style={{ marginBottom: '16px', maxHeight: '300px', overflowY: 'auto' }}>
                  {removableSources.map(source => (
                    <label
                      key={source}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSources([...selectedSources, source])
                          } else {
                            setSelectedSources(selectedSources.filter(s => s !== source))
                          }
                        }}
                        style={{ marginRight: '8px' }}
                      />
                      <code style={{ fontSize: '13px' }}>{source}</code>
                    </label>
                  ))}
                </div>

                <div className="sw-confirm-warning">
                  {t('software.removeSourcesWarning')}
                </div>
              </>
            )}

            <div className="sw-confirm-actions">
              <button
                className="sw-action-btn"
                onClick={() => setSourcesModalOpen(false)}
                disabled={sourcesLoading}
              >
                {t('common.cancel')}
              </button>
              <button
                className="sw-action-btn danger"
                onClick={handleRemoveSelectedSources}
                disabled={sourcesLoading || selectedSources.length === 0}
              >
                {t('software.removeSelected')} ({selectedSources.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加软件包源弹窗 */}
      {addSourceModalOpen && (
        <div className="sw-confirm-overlay" onClick={() => setAddSourceModalOpen(false)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">{t('software.addSourceTitle')}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>{t('software.sourceName')}</label>
                <input
                  type="text"
                  value={addSourceName}
                  onChange={e => setAddSourceName(e.target.value)}
                  placeholder={t('software.sourceNamePlaceholder')}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '4px',
                    border: '1px solid var(--border)', fontSize: '14px',
                    background: 'var(--bg-panel)', color: 'var(--text)',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>{t('software.sourceUrl')}</label>
                <input
                  type="text"
                  value={addSourceUrl}
                  onChange={e => setAddSourceUrl(e.target.value)}
                  placeholder={t('software.sourceUrlPlaceholder')}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '4px',
                    border: '1px solid var(--border)', fontSize: '14px',
                    background: 'var(--bg-panel)', color: 'var(--text)',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>{t('software.sourceGpgKey')}</label>
                <input
                  type="text"
                  value={addSourceGpgKey}
                  onChange={e => setAddSourceGpgKey(e.target.value)}
                  placeholder={t('software.sourceGpgKeyPlaceholder')}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '4px',
                    border: '1px solid var(--border)', fontSize: '14px',
                    background: 'var(--bg-panel)', color: 'var(--text)',
                  }}
                />
              </div>
            </div>

            {addSourceError && (
              <div className="sw-confirm-warning" style={{ color: 'var(--red)' }}>{addSourceError}</div>
            )}

            <div className="sw-confirm-actions">
              <button
                className="sw-action-btn"
                onClick={() => setAddSourceModalOpen(false)}
                disabled={addSourceLoading}
              >
                {t('common.cancel')}
              </button>
              <button
                className="sw-action-btn primary"
                onClick={handleAddSource}
                disabled={addSourceLoading || !addSourceName.trim() || !addSourceUrl.trim()}
              >
                {addSourceLoading ? t('software.addingSource') : t('software.addSource')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 自定义软件确认对话框 */}
      {customConfirmAction && (
        <div className="sw-confirm-overlay" onClick={() => setCustomConfirmAction(null)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">
              {customConfirmAction.action === 'install' && t('software.installTitle', { name: customConfirmAction.sw.display_name })}
              {customConfirmAction.action === 'uninstall' && t('software.uninstallTitle', { name: customConfirmAction.sw.display_name })}
              {customConfirmAction.action === 'remove' && t('software.removeCustomTitle', { name: customConfirmAction.sw.display_name })}
            </div>
            {customConfirmAction.action === 'uninstall' && (
              <div className="sw-confirm-warning">
                {t('software.uninstallCustomWarning', { name: customConfirmAction.sw.display_name })}
              </div>
            )}
            {customConfirmAction.action === 'remove' && (
              <div className="sw-confirm-warning">
                {t('software.removeCustomWarning')}
              </div>
            )}
            <div className="sw-confirm-actions">
              <button className="sw-action-btn" onClick={() => setCustomConfirmAction(null)}>{t('common.cancel')}</button>
              <button
                className={`sw-action-btn ${customConfirmAction.action === 'uninstall' ? 'danger' : customConfirmAction.action === 'remove' ? '' : 'primary'}`}
                onClick={() => {
                  if (customConfirmAction.action === 'remove') {
                    handleRemoveCustomTracking(customConfirmAction.sw.name)
                  } else {
                    handleCustomAction(customConfirmAction.sw, customConfirmAction.action)
                  }
                  setCustomConfirmAction(null)
                }}
              >
                {customConfirmAction.action === 'install' ? t('common.install') : customConfirmAction.action === 'uninstall' ? t('common.uninstall') : t('software.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加自定义软件弹窗 */}
      {addCustomModalOpen && (
        <div className="sw-confirm-overlay" onClick={() => setAddCustomModalOpen(false)}>
          <div className="sw-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="sw-confirm-title">{t('software.addCustomSoftwareTitle')}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>{t('software.packageNameLabel')}</label>
                <input
                  type="text"
                  value={addCustomName}
                  onChange={e => setAddCustomName(e.target.value)}
                  placeholder={t('software.packageNamePlaceholder')}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '4px',
                    border: '1px solid var(--border)', fontSize: '14px',
                    background: 'var(--bg-panel)', color: 'var(--text)',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>{t('software.displayNameLabel')}</label>
                <input
                  type="text"
                  value={addCustomDisplay}
                  onChange={e => setAddCustomDisplay(e.target.value)}
                  placeholder={t('software.displayNamePlaceholder')}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '4px',
                    border: '1px solid var(--border)', fontSize: '14px',
                    background: 'var(--bg-panel)', color: 'var(--text)',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>{t('software.categoryLabel')}</label>
                <select
                  value={addCustomCategory}
                  onChange={e => setAddCustomCategory(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '4px',
                    border: '1px solid var(--border)', fontSize: '14px',
                    background: 'var(--bg-panel)', color: 'var(--text)',
                  }}
                >
                  <option value="other">{t('software.catOther')}</option>
                  <option value="web">{t('software.webServer')}</option>
                  <option value="database">{t('software.database')}</option>
                  <option value="runtime">{t('software.runtime')}</option>
                  <option value="tools">{t('software.tools')}</option>
                  <option value="container">{t('software.container')}</option>
                </select>
              </div>
            </div>

            {addCustomError && (
              <div className="sw-confirm-warning" style={{ color: 'var(--red)' }}>{addCustomError}</div>
            )}

            <div className="sw-confirm-actions">
              <button className="sw-action-btn" onClick={() => setAddCustomModalOpen(false)} disabled={addCustomLoading}>
                {t('common.cancel')}
              </button>
              <button
                className="sw-action-btn primary"
                onClick={handleAddCustomSoftware}
                disabled={addCustomLoading || !addCustomName.trim()}
              >
                {addCustomLoading ? t('common.loading') : t('software.addCustomSoftware')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apache 配置编辑器 */}
      {configEditorOpen && (
        <div className="fb-dialog-overlay" style={{ zIndex: 1100 }} onClick={() => setConfigEditorOpen(false)}>
          <div
            className={`config-editor-dialog${configEditorMaximized ? ' maximized' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="config-editor-header">
              <span className="config-editor-title">{configEditorTitle} Config — {configEditorPath}</span>
              <div className="config-editor-header-btns">
                <button
                  className="config-editor-maximize"
                  onClick={() => setConfigEditorMaximized(!configEditorMaximized)}
                  title={configEditorMaximized ? t('files.restore') : t('files.maximize')}
                >
                  {configEditorMaximized ? '❐' : '▢'}
                </button>
                <button className="config-editor-close" onClick={() => setConfigEditorOpen(false)}>×</button>
              </div>
            </div>
            {configEditorLoading ? (
              <div className="config-editor-loading">Loading...</div>
            ) : (
              <textarea
                className="config-editor-textarea"
                value={configEditorContent}
                onChange={(e) => setConfigEditorContent(e.target.value)}
                spellCheck={false}
              />
            )}
            <div className="config-editor-footer">
              <button className="fb-dialog-btn" onClick={() => setConfigEditorOpen(false)} disabled={configEditorSaving}>{t('common.cancel')}</button>
              <button
                className="fb-dialog-btn primary"
                disabled={configEditorLoading || configEditorSaving}
                onClick={handleSaveConfig}
              >
                {configEditorSaving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
