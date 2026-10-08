import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'

interface LnmpStatus {
  nginx_installed: boolean
  php_installed: boolean
  nginx_version: string
  php_version: string
}

interface OsInfo {
  distro: string
  version: string
  family: string
  hostname: string
}

interface InstallLnmpProps {
  sessionId: string | null
  onInstallationComplete?: () => void
}

type InstallState = 'checking' | 'ready' | 'installing' | 'done' | 'error'

export default function InstallLnmp({ sessionId, onInstallationComplete }: InstallLnmpProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<InstallState>('checking')
  const [lnmpStatus, setLnmpStatus] = useState<LnmpStatus | null>(null)
  const [osInfo, setOsInfo] = useState<OsInfo | null>(null)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  // 组件选择
  const [installNginx, setInstallNginx] = useState(true)
  const [installPhp, setInstallPhp] = useState(true)
  const [reinstall, setReinstall] = useState(false)

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // 检查当前状态
  const checkStatus = async () => {
    if (!sessionId) return
    setState('checking')
    setError('')
    try {
      const [lnmp, sysInfo] = await Promise.all([
        invoke<LnmpStatus>('server_check_lnmp', { sessionId }),
        invoke<{ os: OsInfo }>('server_get_system_info', { sessionId }),
      ])
      setLnmpStatus(lnmp)
      setOsInfo(sysInfo.os)

      // 根据未安装的组件自动选择
      if (lnmp.nginx_installed) setInstallNginx(false)
      if (lnmp.php_installed) setInstallPhp(false)
      setReinstall(false)

      setState('ready')
    } catch (e) {
      setError(String(e))
      setState('error')
    }
  }

  useEffect(() => {
    checkStatus()
  }, [sessionId])

  // 监听安装进度事件
  useEffect(() => {
    if (!sessionId) return
    const unlisten = listen<{ sessionId: string; line: string; status: string }>(
      'lnmp-install-progress',
      (event) => {
        if (event.payload.sessionId !== sessionId) return
        setLogs((prev) => [...prev, event.payload.line])
        if (event.payload.status === 'done') {
          setState('done')
        } else if (event.payload.status === 'error') {
          setState('error')
        }
      }
    )
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [sessionId])

  const handleInstall = async () => {
    if (!sessionId) return
    if (!installNginx && !installPhp) {
      setError('Please select at least one component to install')
      return
    }

    setState('installing')
    setLogs([`Starting LNMP installation on ${osInfo?.hostname || 'server'}...`])
    setError('')

    try {
      await invoke('server_install_lnmp', {
        sessionId,
        config: {
          install_nginx: installNginx,
          install_php: installPhp,
        },
      })
      setState('done')
      // 安装成功后通知父组件重连
      onInstallationComplete?.()
    } catch (e) {
      const msg = String(e)
      setError(msg.length > 200 ? msg.slice(0, 200) + '...' : msg)
      setState('error')
    }
  }

  if (!sessionId) {
    return <div className="sp-empty">{t('install.connectToInstall')}</div>
  }

  const allInstalled = lnmpStatus &&
    lnmpStatus.nginx_installed &&
    lnmpStatus.php_installed

  return (
    <div className="install-lnmp">
      <div className="install-header">
        <h2>{t('install.title')}</h2>
        {osInfo && (
          <span className="install-os-badge">
            {osInfo.distro} {osInfo.version}
          </span>
        )}
      </div>

      {/* 当前状态 */}
      {state === 'checking' && (
        <div className="sp-loading">{t('install.checkingStatus')}</div>
      )}

      {state === 'error' && lnmpStatus === null && (
        <div className="sp-error">
          <p>{t('install.failedToCheck', { error })}</p>
          <button className="sp-retry-btn" onClick={checkStatus}>Retry</button>
        </div>
      )}

      {/* 已全部安装 */}
      {state === 'ready' && allInstalled && !reinstall && (
        <div className="install-all-done">
          <div className="install-done-icon">✓</div>
          <h3>{t('install.allInstalled')}</h3>
          <div className="install-current-status">
            {lnmpStatus && (
              <>
                <span className="install-component">Nginx {lnmpStatus.nginx_version}</span>
                <span className="install-component">PHP {lnmpStatus.php_version}</span>
              </>
            )}
          </div>
          <button className="install-reinstall-btn" onClick={() => {
            setReinstall(true)
            setInstallNginx(true)
            setInstallPhp(true)
          }}>
            {t('install.reinstallUpgrade')}
          </button>
        </div>
      )}

      {/* 选择界面 */}
      {(state === 'ready' && (!allInstalled || reinstall)) && (
        <div className="install-form">
          {/* 状态摘要 */}
          {lnmpStatus && (
            <div className="install-status-summary">
              <div className="install-status-title">{t('install.currentStatus')}</div>
              <div className="install-status-grid">
                <StatusBadge label="Nginx" installed={lnmpStatus.nginx_installed} version={lnmpStatus.nginx_version} />
                <StatusBadge label="PHP" installed={lnmpStatus.php_installed} version={lnmpStatus.php_version} />
              </div>
            </div>
          )}

          <div className="install-select-title">{reinstall ? t('install.selectReinstall') : t('install.selectComponents')}</div>

          {/* Nginx */}
          <label className="install-option">
            <input
              type="checkbox"
              checked={installNginx}
              onChange={(e) => setInstallNginx(e.target.checked)}
            />
            <div className="install-option-info">
              <span className="install-option-name">{t('install.nginx')}</span>
              <span className="install-option-desc">{t('install.nginxDesc')}</span>
            </div>
          </label>

          {/* PHP */}
          <label className="install-option">
            <input
              type="checkbox"
              checked={installPhp}
              onChange={(e) => setInstallPhp(e.target.checked)}
            />
            <div className="install-option-info">
              <span className="install-option-name">{t('install.phpFpm')}</span>
              <span className="install-option-desc">{t('install.phpDesc')}</span>
            </div>
          </label>

          {error && <div className="install-error">{error}</div>}

          <button className="install-btn" onClick={handleInstall}>
            {reinstall ? t('install.reinstallSelected') : t('install.installSelected')}
          </button>
        </div>
      )}

      {/* 安装进度 */}
      {(state === 'installing' || state === 'done') && (
        <div className="install-progress">
          <div className={`install-progress-header ${state}`}>
            {state === 'installing' ? (
              <>
                <div className="install-spinner" />
                <span>{t('install.installing')}</span>
              </>
            ) : (
              <>
                <span className="install-done-icon-small">✓</span>
                <span>{t('install.installationComplete')}</span>
              </>
            )}
          </div>
          <div className="install-log">
            {logs.map((line, i) => (
              <div className="install-log-line" key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
          {state === 'done' && (
            <button className="install-done-btn" onClick={checkStatus}>
              {t('install.refreshStatus')}
            </button>
          )}
        </div>
      )}

      {/* 安装期间发生错误 */}
      {state === 'error' && lnmpStatus !== null && (
        <div className="install-progress">
          <div className="install-progress-header error">
            <span>{t('install.installationFailed')}</span>
          </div>
          <div className="install-log">
            {logs.map((line, i) => (
              <div className="install-log-line" key={i}>{line}</div>
            ))}
            {error && <div className="install-log-line error">{error}</div>}
          </div>
          <button className="install-retry-btn" onClick={handleInstall}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ label, installed, version }: { label: string; installed: boolean; version: string }) {
  return (
    <div className={`install-badge ${installed ? 'installed' : 'not-installed'}`}>
      <span className="install-badge-dot" />
      <span>{label}</span>
      {installed && version && <span className="install-badge-ver">v{version}</span>}
    </div>
  )
}
