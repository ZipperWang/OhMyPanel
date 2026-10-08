import { useState, useEffect, useRef, useCallback, type Ref } from 'react'
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
import { parseConnectionHost } from './terminal/terminalActions'
import type { TerminalConnectionState, TerminalDimensions } from './terminal/types'
import FileBrowser, { type FileBrowserHandle } from './FileBrowser'
import { isPanelSection, type PanelSection } from './navigation'

export type { PanelSection }

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
  // ponytail：当前面板由 App 统一控制，导航栏位于全局侧边栏
  section: PanelSection
  onNavigate: (section: PanelSection) => void
  jumpToPath?: string | null
  setJumpToPath?: (path: string | null) => void
  termRef?: Ref<TerminalHandle>
  onStartUpload?: (files: { file: File; fileName: string; remotePath: string }[]) => void
  onUploadComplete?: React.MutableRefObject<(() => void) | null>
  appSettings?: AppSettings
  onToggleAutoReconnect?: () => void
  onUpdateSettings?: (settings: Partial<AppSettings>) => Promise<void>
  isSessionActive?: boolean
  connectionState?: TerminalConnectionState
  onReconnect?: () => void
  onCancelReconnect?: () => void
  onCloseSession?: () => void
  onNewSession?: () => void
  onDuplicateSession?: () => void
  onCloseOtherSessions?: () => void
  onNextSession?: () => void
  onPreviousSession?: () => void
  onEditConnection?: () => void
  onTerminalDimensionsChange?: (dimensions: TerminalDimensions) => void
  onTerminalBackgroundOutput?: () => void
}

export default function ServerPanel({ sessionId, connHost, connUsername, section, onNavigate, jumpToPath, setJumpToPath, termRef, onStartUpload, onUploadComplete, appSettings, onToggleAutoReconnect, onUpdateSettings, isSessionActive = true, connectionState, onReconnect, onCancelReconnect, onCloseSession, onNewSession, onDuplicateSession, onCloseOtherSessions, onNextSession, onPreviousSession, onEditConnection, onTerminalDimensionsChange, onTerminalBackgroundOutput }: ServerPanelProps) {
  const terminalHandleRef = useRef<TerminalHandle | null>(null)
  const setTerminalHandle = useCallback((handle: TerminalHandle | null) => {
    terminalHandleRef.current = handle
    if (typeof termRef === 'function') termRef(handle)
    else if (termRef) termRef.current = handle
  }, [termRef])
  const activeSection: PanelSection = isPanelSection(section) ? section : 'dashboard'
  const [mountedSections, setMountedSections] = useState<Set<PanelSection>>(() => new Set(['terminal', activeSection]))
  const cdHereRef = useRef<string | null>(null)
  const fileBrowserRef = useRef<FileBrowserHandle | null>(null)

  // 懒挂载：首次访问某个面板后保持挂载，切换时保留状态
  useEffect(() => {
    setMountedSections(previous => previous.has(activeSection) ? previous : new Set(previous).add(activeSection))
  }, [activeSection])

  const isMounted = (key: PanelSection) => activeSection === key || mountedSections.has(key)
  const setActiveSection = onNavigate

  const handleNavigate = (target: string) => {
    if (isPanelSection(target)) setActiveSection(target)
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
      setTimeout(() => terminalHandleRef.current?.sendCommand(`cd '${path}'`), 200)
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
    if (isSessionActive && activeSection === 'files' && fileBrowserRef.current) {
      fileBrowserRef.current.focus()
    }
  }, [activeSection, isSessionActive])

  useEffect(() => {
    if (!onUploadComplete || !isSessionActive) return
    onUploadComplete.current = handleUploadComplete
    return () => {
      if (onUploadComplete.current === handleUploadComplete) onUploadComplete.current = null
    }
  }, [onUploadComplete, handleUploadComplete, isSessionActive])

  const endpoint = connHost ? parseConnectionHost(connHost) : null
  const endpointText = endpoint ? `${endpoint.host}:${endpoint.port}` : ''
  const connectionLabel = endpoint ? `${connUsername || 'root'}@${endpoint.host}` : ''

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
      <div className={`sp-content ${activeSection === 'terminal' ? 'terminal-page' : ''}`}>
        <div className={`terminal-panel-slot ${activeSection === 'terminal' ? 'active' : ''}`}>
          <Terminal
            ref={setTerminalHandle}
            sessionId={sessionId}
            isActive={isSessionActive && activeSection === 'terminal'}
            connectionState={connectionState}
            connectionLabel={connectionLabel}
            endpoint={endpointText}
            onReconnect={onReconnect}
            onCancelReconnect={onCancelReconnect}
            onCloseSession={onCloseSession}
            onNewSession={onNewSession}
            onDuplicateSession={onDuplicateSession}
            onCloseOtherSessions={onCloseOtherSessions}
            onNextSession={onNextSession}
            onPreviousSession={onPreviousSession}
            onOpenConnectionSettings={onEditConnection}
            onDimensionsChange={onTerminalDimensionsChange}
            onBackgroundOutput={onTerminalBackgroundOutput}
          />
        </div>
        {isMounted('files') && <div style={{ display: activeSection === 'files' ? 'block' : 'none', height: '100%' }}>
          <FileBrowser sessionId={sessionId} connHost={connHost} jumpToPath={jumpToPath} ref={fileBrowserRef} onCdHere={handleCdHere} onStartUpload={onStartUpload} onNavigateToSoftware={() => setActiveSection('software')} />
        </div>}
        {isMounted('sites') && <div style={{ display: activeSection === 'sites' ? 'block' : 'none', height: '100%' }}>
          <SitesPanel sessionId={sessionId} onOpenFolder={handleInternalOpenFolder} visible={activeSection === 'sites'} onNavigateToSoftware={() => setActiveSection('software')} />
        </div>}
        {isMounted('software') && <div style={{ display: activeSection === 'software' ? 'block' : 'none', height: '100%' }}>
          <SoftwareRepo sessionId={sessionId} />
        </div>}
        {isMounted('update') && <div style={{ display: activeSection === 'update' ? 'block' : 'none', height: '100%' }}>
          <UpdatePanel />
        </div>}
        {activeSection !== 'terminal' && activeSection !== 'files' && activeSection !== 'sites' && activeSection !== 'software' && activeSection !== 'update' && renderContent()}
      </div>
    </div>
  )
}
