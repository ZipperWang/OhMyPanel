import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-shell'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import Icon, { type IconName } from '../icons'

interface OsInfo {
  distro: string
  version: string
  codename: string
  family: string
  kernel: string
  arch: string
  hostname: string
}

interface DiskInfo {
  filesystem: string
  size: string
  used: string
  available: string
  use_percent: string
  mount: string
}

interface SystemInfo {
  os: OsInfo
  uptime: string
  load_avg: string
  cpu_model: string
  cpu_cores: number
  cpu_percent?: number
  mem_total_mb: number
  mem_used_mb: number
  mem_free_mb: number
  swap_total_mb: number
  swap_used_mb: number
  disks: DiskInfo[]
}

interface ServiceStatus {
  name: string
  active: boolean
  status_text: string
  version: string
}

interface DashboardProps {
  sessionId: string | null
  onNavigate?: (section: string) => void
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function percentBar(used: number, total: number): { percent: number; color: string } {
  if (total === 0) return { percent: 0, color: 'var(--accent-strong)' }
  const pct = Math.round((used / total) * 100)
  return { percent: pct, color: levelColor(pct) }
}

function levelColor(pct: number): string {
  return pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--yellow)' : 'var(--accent-strong)'
}

// 关于文案中的 **文本** 渲染为加粗
function renderEmphasis(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
  )
}

function StatTile({ icon, label, value, percent, color, detail }: { icon: IconName; label: string; value: string; percent?: number; color?: string; detail?: string }) {
  return (
    <div className="dash-stat">
      <div className="dash-stat-label">
        <Icon name={icon} size={15} />
        <span>{label}</span>
      </div>
      <div className="dash-stat-value">{value}</div>
      {percent !== undefined && (
        <div className="dash-meter"><div className="dash-meter-fill" style={{ width: `${Math.min(percent, 100)}%`, background: color }} /></div>
      )}
      {detail && <div className="dash-stat-detail" title={detail}>{detail}</div>}
    </div>
  )
}

export default function Dashboard({ sessionId, onNavigate }: DashboardProps) {
  const { t } = useTranslation()
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}) }, [])

  const fetchData = async () => {
    if (!sessionId) return
    setLoading(true)
    setError('')
    try {
      const [info, svcs] = await Promise.all([
        invoke<SystemInfo>('server_get_system_info', { sessionId }),
        invoke<ServiceStatus[]>('server_get_service_statuses', { sessionId }),
      ])
      setSysInfo(info)
      setServices(svcs)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // 仅在标签页可见时每 30 秒自动刷新
    let interval: number | undefined
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 标签页隐藏，清除定时器以停止轮询
        if (interval) clearInterval(interval)
        interval = undefined
      } else {
        // 标签页可见，立即刷新并重新开始轮询
        fetchData()
        interval = setInterval(fetchData, 30000)
      }
    }
    
    // 开始轮询
    interval = setInterval(fetchData, 30000)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [sessionId])

  if (!sessionId) {
    return <div className="sp-empty">{t('dashboard.connectToView')}</div>
  }

  if (loading && !sysInfo) {
    return <div className="sp-loading">{t('dashboard.loadingSystem')}</div>
  }

  if (error && !sysInfo) {
    return (
      <div className="sp-error">
        <p>{t('common.failedToLoad', { error })}</p>
        <button className="sp-retry-btn" onClick={fetchData}>{t('common.retry')}</button>
      </div>
    )
  }

  const mem = sysInfo ? percentBar(sysInfo.mem_used_mb, sysInfo.mem_total_mb) : null
  const swap = sysInfo ? percentBar(sysInfo.swap_used_mb, sysInfo.swap_total_mb) : null
  const cpu = sysInfo && sysInfo.cpu_percent !== undefined ? percentBar(sysInfo.cpu_percent, 100) : null

  // 对 MySQL/MariaDB 服务去重
  const displayServices = services.filter(s => {
    if (s.name === 'mysql' && services.some(x => x.name === 'mysqld' && x.active)) return false
    return true
  })

  const serviceLabel = (name: string) => {
    const map: Record<string, string> = {
      nginx: 'Nginx',
      mysqld: 'MySQL',
      mariadb: 'MariaDB',
      mysql: 'MySQL',
      'php-fpm': 'PHP-FPM',
    }
    return map[name] || name
  }

  const infoRows: [string, string][] = sysInfo ? [
    [t('dashboard.os'), `${sysInfo.os.distro} ${sysInfo.os.version}`],
    [t('dashboard.kernel'), sysInfo.os.kernel],
    [t('dashboard.architecture'), sysInfo.os.arch],
    [t('dashboard.hostname'), sysInfo.os.hostname],
    [t('dashboard.uptime'), sysInfo.uptime],
    [t('dashboard.loadAverage'), sysInfo.load_avg],
  ] : []

  return (
    <div className="sp-dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-subtitle">
            {sysInfo ? <>{sysInfo.os.hostname} · {sysInfo.os.distro} {sysInfo.os.version}</> : t('dashboard.welcome')}
          </p>
        </div>
        <button className="ui-btn" onClick={fetchData} disabled={loading}>
          <Icon name="refresh" size={14} className={loading ? 'spin' : undefined} />
          {loading ? t('common.refreshing') : t('common.refresh')}
        </button>
      </div>

      {sysInfo && (
        <div className="dash-stats">
          {cpu && (
            <StatTile
              icon="cpu"
              label={t('dashboard.cpu')}
              value={`${sysInfo.cpu_percent}%`}
              percent={cpu.percent}
              color={cpu.color}
              detail={`${sysInfo.cpu_cores} ${t('dashboard.cores')} · ${sysInfo.cpu_model}`}
            />
          )}
          {mem && (
            <StatTile
              icon="memory"
              label={t('dashboard.memory')}
              value={`${mem.percent}%`}
              percent={mem.percent}
              color={mem.color}
              detail={`${formatMb(sysInfo.mem_used_mb)} / ${formatMb(sysInfo.mem_total_mb)}`}
            />
          )}
          {swap && (
            <StatTile
              icon="layers"
              label={t('dashboard.swap')}
              value={sysInfo.swap_total_mb > 0 ? `${swap.percent}%` : '—'}
              percent={sysInfo.swap_total_mb > 0 ? swap.percent : 0}
              color={swap.color}
              detail={sysInfo.swap_total_mb > 0 ? `${formatMb(sysInfo.swap_used_mb)} / ${formatMb(sysInfo.swap_total_mb)}` : t('common.disabled')}
            />
          )}
          <StatTile
            icon="activity"
            label={t('dashboard.loadAverage')}
            value={sysInfo.load_avg.split(/\s+/)[0] || '—'}
            detail={`${sysInfo.load_avg} · ${sysInfo.uptime}`}
          />
        </div>
      )}

      <div className="dash-grid">
        {sysInfo && (
          <section className="sp-card">
            <div className="sp-card-title">{t('dashboard.system')}</div>
            <dl className="dash-info">
              {infoRows.map(([label, value]) => (
                <div className="dash-info-row" key={label}>
                  <dt>{label}</dt>
                  <dd title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="sp-card">
          <div className="sp-card-title">{t('dashboard.services')}</div>
          {displayServices.length === 0 ? (
            <div className="sp-services-empty">
              <p>{t('dashboard.noLnmp')}</p>
              {onNavigate && (
                <button className="ui-btn sm" onClick={() => onNavigate('software')}>
                  {t('dashboard.installLnmp')}
                </button>
              )}
            </div>
          ) : (
            <div className="dash-services">
              {displayServices.map(svc => (
                <div className="dash-service" key={svc.name}>
                  <span className={`status-dot ${svc.active ? 'connected' : ''}`} />
                  <span className="dash-service-name">{serviceLabel(svc.name)}</span>
                  {svc.version && <span className="dash-service-version">v{svc.version}</span>}
                  <span className={`dash-pill ${svc.active ? 'ok' : 'off'}`}>
                    {svc.active ? t('common.running') : t('common.stopped')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {sysInfo && sysInfo.disks.length > 0 && (
        <section className="sp-card">
          <div className="sp-card-title">{t('dashboard.disk')}</div>
          <div className="dash-disks">
            {sysInfo.disks.map((d, i) => {
              const pct = parseInt(d.use_percent) || 0
              return (
                <div className="dash-disk" key={i}>
                  <div className="dash-disk-head">
                    <Icon name="hardDrive" size={15} />
                    <span className="dash-disk-mount">{d.mount}</span>
                    <span className="dash-disk-fs">{d.filesystem}</span>
                    <span className="dash-disk-usage">{d.used} / {d.size}</span>
                    <span className="dash-disk-pct" style={{ color: pct > 70 ? levelColor(pct) : undefined }}>{d.use_percent}</span>
                  </div>
                  <div className="dash-meter"><div className="dash-meter-fill" style={{ width: `${pct}%`, background: levelColor(pct) }} /></div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="sp-card dash-about">
        <div className="sp-card-title">
          {t('about.title')}
          {appVersion && <span className="ui-badge">v{appVersion}</span>}
        </div>
        <div className="sp-about-content">
          <p>{t('about.line1')}</p>
          <p>{t('about.line2')} {t('about.line3')}</p>
          <p>{renderEmphasis(t('about.line4'))}</p>
          <p>{t('about.line5')}</p>
          <p>{t('about.line6')}</p>
          <p>{t('about.line7')} <a href="#" onClick={(e) => { e.preventDefault(); open('https://github.com/ZipperWang/OhMyPanel/discussions') }}>{t('about.github')}</a></p>
        </div>
      </section>
    </div>
  )
}
