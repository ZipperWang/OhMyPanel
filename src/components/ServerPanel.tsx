import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-shell'
import Dashboard from './panels/Dashboard'
// ponytail：已移除 InstallLnmp
// import InstallLnmp from './panels/InstallLnmp'
import NginxPanel from './panels/NginxPanel'
// ponytail：PhpPanel 尚未接入
// import PhpPanel from './panels/PhpPanel'
import SitesPanel from './panels/SitesPanel'
import SslPanel from './panels/SslPanel'
import MonitorPanel from './panels/MonitorPanel'
import FirewallPanel from './panels/FirewallPanel'
import PortPanel from './panels/PortPanel'
import SoftwareRepo from './panels/SoftwareRepo'
import ServerSettingsPanel from './panels/ServerSettingsPanel'
import UpdatePanel from './panels/UpdatePanel'
import SiteLogsPanel from './panels/SiteLogsPanel'
import BbrPanel from './panels/BbrPanel'
import DatabasePanel from './panels/DatabasePanel'
import RedisPanel from './panels/RedisPanel'
import DockerPanel from './panels/DockerPanel'
import TunnelPanel from './panels/TunnelPanel'
import Terminal from './Terminal'
import type { TerminalHandle } from './Terminal'
import FileBrowser, { type FileBrowserHandle } from './FileBrowser'

type PanelSection = 'dashboard' | 'terminal' | 'files' | 'software' | 'nginx' | 'php' | 'sites' | 'logs' | 'ssl' | 'monitor' | 'firewall' | 'port' | 'tunnel' | 'bbr' | 'docker' | 'database' | 'redis' | 'update' | 'settings' | 'discussions'

interface AppSettings {
  auto_reconnect: boolean
  reconnect_interval: number
  max_reconnect_attempts: number
  close_tab_on_disconnect: boolean
  cache_ttl_hours: number
  cache_max_files: number
  cache_enabled: boolean
  command_timeout_minutes: number
  upload_workers: number
  theme: string
}

interface ServerPanelProps {
  sessionId: string | null
  connHost?: string
  connUsername?: string
  initialSection?: string
  jumpToPath?: string | null
  setJumpToPath?: (path: string | null) => void
  termRef?: React.RefObject<TerminalHandle | null>
  onStartUpload?: (files: { file: File; fileName: string; remotePath: string }[]) => void
  onUploadComplete?: React.MutableRefObject<(() => void) | null>
  appSettings?: AppSettings
  onToggleAutoReconnect?: () => void
  onUpdateSettings?: (settings: Partial<AppSettings>) => Promise<void>
  onShowToast?: (msg: string) => void
}

const NAV_ITEMS: { key: PanelSection; labelKey: string }[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard' },
  { key: 'terminal', labelKey: 'nav.terminal' },
  { key: 'files', labelKey: 'nav.files' },
  { key: 'software', labelKey: 'nav.software' },
  { key: 'sites', labelKey: 'nav.sites' },
  { key: 'ssl', labelKey: 'nav.ssl' },
  { key: 'docker', labelKey: 'nav.docker' },
  { key: 'database', labelKey: 'nav.database' },
  { key: 'redis', labelKey: 'nav.redis' },
  { key: 'logs', labelKey: 'nav.logs' },
  { key: 'monitor', labelKey: 'nav.monitor' },
  { key: 'firewall', labelKey: 'nav.firewall' },
  { key: 'port', labelKey: 'nav.port' },
  { key: 'tunnel', labelKey: 'nav.tunnel' },
  { key: 'bbr', labelKey: 'nav.bbr' },
  { key: 'update', labelKey: 'nav.update' },
  { key: 'settings', labelKey: 'nav.settings' },
  { key: 'discussions', labelKey: 'nav.discussions' },
]

export default function ServerPanel({ sessionId, connHost, connUsername, initialSection = 'dashboard', jumpToPath, setJumpToPath, termRef, onStartUpload, onUploadComplete, appSettings, onToggleAutoReconnect, onUpdateSettings, onShowToast }: ServerPanelProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSectionRaw] = useState<PanelSection>((initialSection && NAV_ITEMS.some(s => s.key === initialSection) ? initialSection : 'dashboard') as PanelSection)
  const cdHereRef = useRef<string | null>(null)
  const fileBrowserRef = useRef<FileBrowserHandle | null>(null)

  // ponytail：按服务器保存面板记忆，键为 lastPanel_${user}@${host}
  const panelKey = connHost && connUsername ? `lastPanel_${connUsername}@${connHost}` : ''

  // initialSection 变化时同步 activeSection（key 重挂载已能处理，但保留此逻辑作为安全保障）
  useEffect(() => {
    if (initialSection && NAV_ITEMS.some(s => s.key === initialSection)) {
      setActiveSectionRaw(initialSection as PanelSection)
    }
  }, [initialSection])

  const setActiveSection = (key: PanelSection) => {
    setActiveSectionRaw(key)
    if (panelKey) invoke('ui_state_set', { key: panelKey, value: key }).catch(() => {})
  }

  const handleNavigate = (section: string) => {
    setActiveSection(section as PanelSection)
  }

  // ponytail：移除连接后自动切换到终端的逻辑，让用户自行选择目标面板

  // FileBrowser 使用 jumpToPath 后将其清空
  useEffect(() => {
    if (jumpToPath && activeSection === 'files') {
      const timer = setTimeout(() => setJumpToPath?.(null), 100)
      return () => clearTimeout(timer)
    }
  }, [jumpToPath, activeSection]) // eslint-disable-line

  // 处理来自 FileBrowser 的 cd-here
  useEffect(() => {
    if (activeSection === 'terminal' && cdHereRef.current) {
      const path = cdHereRef.current
      cdHereRef.current = null
      setTimeout(() => termRef?.current?.sendCommand(`cd '${path}'`), 200)
    }
  }, [activeSection]) // eslint-disable-line

  const handleInternalOpenFolder = (path: string) => {
    setJumpToPath?.(path)
    setActiveSection('files')
  }

  const handleCdHere = (path: string) => {
    cdHereRef.current = path
    setActiveSection('terminal')
  }

  // 处理上传完成事件，刷新当前目录
  const handleUploadComplete = useCallback(() => {
    if (fileBrowserRef.current && activeSection === 'files') {
      fileBrowserRef.current.refreshCurrentDirectory()
    }
  }, [activeSection])

  // ponytail：切换标签页时自动聚焦 FileBrowser，使键盘快捷键立即生效
  useEffect(() => {
    if (activeSection === 'files' && fileBrowserRef.current) {
      fileBrowserRef.current.focus()
    }
  }, [activeSection])

  useEffect(() => {
    if (onUploadComplete) onUploadComplete.current = handleUploadComplete
  }, [onUploadComplete, handleUploadComplete])

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return <Dashboard sessionId={sessionId} onNavigate={handleNavigate} />
      // case 'install':
      //   return <InstallLnmp sessionId={sessionId} onInstallationComplete={onReconnect} />
      case 'nginx':
        return <NginxPanel sessionId={sessionId} />
      // case 'php':
      //   return <PhpPanel sessionId={sessionId} />
      case 'logs':
        return <SiteLogsPanel sessionId={sessionId} />
      case 'ssl':
        return <SslPanel sessionId={sessionId} />
      case 'monitor':
        return <MonitorPanel sessionId={sessionId} />
      case 'firewall':
        return <FirewallPanel sessionId={sessionId} />
      case 'port':
        return <PortPanel sessionId={sessionId} />
      // case 'software'：已移除，下面始终挂载
      case 'bbr':
        return <BbrPanel sessionId={sessionId} />
      case 'database':
        return <DatabasePanel sessionId={sessionId} onNavigateToSoftware={() => setActiveSection('software')} />
      case 'redis':
        return <RedisPanel sessionId={sessionId} onNavigateToSoftware={() => setActiveSection('software')} />
      case 'docker':
        return <DockerPanel sessionId={sessionId} onNavigateToSoftware={() => setActiveSection('software')} />
      case 'tunnel':
        return <TunnelPanel
          sessionId={sessionId}
          serverHost={connHost ? (connHost.includes('_') ? connHost.slice(0, connHost.lastIndexOf('_')) : connHost) : undefined}
          connUsername={connUsername}
        />
      case 'settings':
        return <ServerSettingsPanel sessionId={sessionId} appSettings={appSettings} onToggleAutoReconnect={onToggleAutoReconnect} onUpdateSettings={onUpdateSettings} />
      default:
        return null
    }
  }

  return (
    <div className="server-panel">
      <nav className="sp-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            className={`sp-nav-item ${activeSection === item.key ? 'active' : ''}`}
            onClick={() => {
              if (item.key === 'discussions') { open('https://github.com/ZipperWang/OhMyPanel/discussions'); return }
              // ponytail：没有会话时显示 Toast 提示，而不是禁用导航项
              if (!sessionId) { onShowToast?.(t('common.connectFirst')); return }
              setActiveSection(item.key)
            }}
          >
            <span className="sp-nav-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>
      <div className="sp-content">
        {/* 始终挂载终端以保留 SSH 会话 */}
        <div style={{ display: activeSection === 'terminal' ? 'block' : 'none', height: '100%' }}>
          <Terminal ref={termRef} sessionId={sessionId} isActive={activeSection === 'terminal'} theme={appSettings?.theme || 'light'} />
        </div>
        {/* 始终挂载文件面板以保留状态并避免重新加载闪烁 */}
        <div style={{ display: activeSection === 'files' ? 'block' : 'none', height: '100%' }}>
          <FileBrowser sessionId={sessionId} connHost={connHost} jumpToPath={jumpToPath} ref={fileBrowserRef} onCdHere={handleCdHere} onStartUpload={onStartUpload} onNavigateToSoftware={() => setActiveSection('software')} />
        </div>
        {/* 始终挂载站点面板以保留列表状态 */}
        <div style={{ display: activeSection === 'sites' ? 'block' : 'none', height: '100%' }}>
          <SitesPanel sessionId={sessionId} onOpenFolder={handleInternalOpenFolder} visible={activeSection === 'sites'} onNavigateToSoftware={() => setActiveSection('software')} />
        </div>
        {/* 始终挂载软件面板以保留安装进度状态 */}
        <div style={{ display: activeSection === 'software' ? 'block' : 'none', height: '100%' }}>
          <SoftwareRepo sessionId={sessionId} />
        </div>
        {/* 始终挂载更新面板以保留更新状态 */}
        <div style={{ display: activeSection === 'update' ? 'block' : 'none', height: '100%' }}>
          <UpdatePanel />
        </div>
        {activeSection !== 'terminal' && activeSection !== 'files' && activeSection !== 'sites' && activeSection !== 'software' && activeSection !== 'update' && renderContent()}
      </div>
    </div>
  )
}
