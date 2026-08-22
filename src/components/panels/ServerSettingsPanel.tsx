import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'

interface SshKeyPair {
  public_key_openssh: string
  private_key_path: string
}

interface SshAuthMode {
  password: boolean
  pubkey: boolean
}

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

interface ServerSettingsPanelProps {
  sessionId: string | null
  appSettings?: AppSettings
  onToggleAutoReconnect?: () => void
  onUpdateSettings?: (settings: Partial<AppSettings>) => Promise<void>
}

export default function ServerSettingsPanel({ sessionId, appSettings, onToggleAutoReconnect, onUpdateSettings }: ServerSettingsPanelProps) {
  const { t } = useTranslation()
  // 重启状态
  const [rebootLoading, setRebootLoading] = useState(false)
  const [rebootConfirm, setRebootConfirm] = useState<{ show: boolean; force: boolean }>({ show: false, force: false })
  const [rebootExecPanel, setRebootExecPanel] = useState<{ show: boolean; logs: string[]; status: 'running' | 'done' | 'error' }>({ show: false, logs: [], status: 'running' })

  // SSH 身份验证模式状态
  const [authMode, setAuthMode] = useState<SshAuthMode | null>(null)
  const [authModeLoading, setAuthModeLoading] = useState(false)
  const [authModeSaving, setAuthModeSaving] = useState(false)
  const [authModeError, setAuthModeError] = useState('')

  // SSH 密钥生成状态
  const [keyAlgorithm, setKeyAlgorithm] = useState('ed25519')
  const [keyPair, setKeyPair] = useState<SshKeyPair | null>(null)
  const [keyGenLoading, setKeyGenLoading] = useState(false)
  const [keyDeployLoading, setKeyDeployLoading] = useState(false)
  const [keyMessage, setKeyMessage] = useState('')
  const [keyError, setKeyError] = useState('')

  // 应用设置编辑状态
  const [reconnectIntervalInput, setReconnectIntervalInput] = useState<string>('')
  const [maxAttemptsInput, setMaxAttemptsInput] = useState<string>('')
  const [cacheLimitInput, setCacheLimitInput] = useState<string>('')
  const [cacheMaxFilesInput, setCacheMaxFilesInput] = useState<string>('')
  const [commandTimeoutInput, setCommandTimeoutInput] = useState<string>('')
  const [uploadWorkersInput, setUploadWorkersInput] = useState<string>('')
  const [settingsSaving, setSettingsSaving] = useState(false)

  // 缓存管理状态
  const [cacheCount, setCacheCount] = useState<number>(0)
  const [cacheClearing, setCacheClearing] = useState(false)

  // 数据目录状态
  const [dataDir, setDataDir] = useState('')
  const [openingDir, setOpeningDir] = useState(false)
  const [dirError, setDirError] = useState('')

  // 运行时长状态
  const [bootTime, setBootTime] = useState('')
  const [uptimeDuration, setUptimeDuration] = useState('')

  // 获取运行时长
  const fetchUptime = useCallback(async () => {
    if (!sessionId) return
    try {
      const [boot, duration] = await invoke<[string, string]>('server_get_uptime', { sessionId })
      setBootTime(boot)
      setUptimeDuration(duration)
    } catch {
      // 忽略
    }
  }, [sessionId])

  // 获取 SSH 身份验证模式
  const fetchAuthMode = useCallback(async () => {
    if (!sessionId) return
    setAuthModeLoading(true)
    try {
      const mode = await invoke<SshAuthMode>('server_get_ssh_auth_mode', { sessionId })
      setAuthMode(mode)
    } catch {
      // 忽略
    } finally {
      setAuthModeLoading(false)
    }
  }, [sessionId])

  // ponytail：获取缓存数量
  const fetchCacheCount = useCallback(async () => {
    try {
      const count = await invoke<number>('fb_cache_count')
      setCacheCount(count)
    } catch { /* 忽略 */ }
  }, [])

  // ponytail：清除所有目录缓存
  const handleClearCache = useCallback(async () => {
    setCacheClearing(true)
    try {
      await invoke('fb_cache_clear_all')
      setCacheCount(0)
    } catch { /* 忽略 */ } finally {
      setCacheClearing(false)
    }
  }, [])

  // ponytail：获取本地 SQLite 数据目录路径
  const fetchDataDir = useCallback(async () => {
    try {
      const dir = await invoke<string>('get_data_dir')
      setDataDir(dir)
    } catch { /* 忽略 */ }
  }, [])

  // 在系统文件管理器中打开本地 SQLite 数据目录
  const handleOpenDataDir = useCallback(async () => {
    setDirError('')
    setOpeningDir(true)
    try {
      await invoke('open_data_dir')
    } catch (e) {
      setDirError(String(e))
    } finally {
      setOpeningDir(false)
    }
  }, [])

  useEffect(() => {
    fetchAuthMode()
    fetchUptime()
    fetchCacheCount()
    fetchDataDir()
  }, [fetchAuthMode, fetchUptime, fetchCacheCount, fetchDataDir])

  // appSettings 变化时同步输入值
  useEffect(() => {
    if (appSettings) {
      setReconnectIntervalInput(String(appSettings.reconnect_interval))
      setMaxAttemptsInput(String(appSettings.max_reconnect_attempts))
      setCacheLimitInput(String(appSettings.cache_ttl_hours))
      setCacheMaxFilesInput(String(appSettings.cache_max_files))
      setCommandTimeoutInput(String(appSettings.command_timeout_minutes))
        setUploadWorkersInput(String(appSettings.upload_workers))
    }
  }, [appSettings])

  // 保存设置
  const handleSaveSettings = async () => {
    if (!onUpdateSettings || !appSettings) return
    const interval = parseInt(reconnectIntervalInput, 10)
    const attempts = parseInt(maxAttemptsInput, 10)
    const ttl = parseInt(cacheLimitInput, 10)
    const maxFiles = parseInt(cacheMaxFilesInput, 10)
    const timeout = parseInt(commandTimeoutInput, 10)
    const workers = parseInt(uploadWorkersInput, 10)
    if (isNaN(interval) || isNaN(attempts) || isNaN(ttl) || isNaN(maxFiles) || isNaN(timeout) || isNaN(workers) || interval < 1 || attempts < 1 || ttl < 1 || maxFiles < 1 || timeout < 1 || workers < 1) return
    setSettingsSaving(true)
    try {
      await onUpdateSettings({
        reconnect_interval: interval,
        max_reconnect_attempts: attempts,
        cache_ttl_hours: ttl,
        cache_max_files: maxFiles,
        command_timeout_minutes: timeout,
        upload_workers: workers,
      })
    } finally {
      setSettingsSaving(false)
    }
  }

  // 重启处理器：打开确认对话框
  const handleReboot = (force: boolean) => {
    if (!sessionId) return
    setRebootConfirm({ show: true, force })
  }

  // 用户确认后实际执行重启
  const execReboot = async () => {
    if (!sessionId) return
    const force = rebootConfirm.force
    setRebootConfirm({ show: false, force: false })
    setRebootLoading(true)

    // 显示执行面板
    setRebootExecPanel({
      show: true,
      logs: ['Executing reboot command...'],
      status: 'running',
    })

    // ponytail：正常重启时抑制自动重连，让用户手动重新连接
    if (!force) {
      window.dispatchEvent(new CustomEvent('normal-reboot', { detail: { sessionId } }))
    }

    try {
      const result = await invoke<string>('server_reboot', { sessionId, force })
      setRebootExecPanel(prev => ({
        ...prev,
        logs: [...prev.logs, `[OK] ${result}`],
        status: 'done',
      }))
    } catch (e) {
      const errMsg = String(e)
      // 重启会断开 SSH，超时或连接错误属于预期的成功结果
      const el = errMsg.toLowerCase()
      if (el.includes('connection') || el.includes('closed') || el.includes('disconnected') || el.includes('timed out') || el.includes('timeout') || el.includes('broken pipe') || el.includes('eof')) {
        setRebootExecPanel(prev => ({
          ...prev,
          logs: [...prev.logs, '[OK] Server is rebooting. SSH connection has been disconnected.'],
          status: 'done',
        }))
      } else {
        setRebootExecPanel(prev => ({
          ...prev,
          logs: [...prev.logs, `[ERROR] ${errMsg}`],
          status: 'error',
        }))
      }
    }
    setRebootLoading(false)
  }

  // 切换身份验证模式
  const handleToggleAuthMode = async (field: 'password' | 'pubkey', value: boolean) => {
    if (!sessionId || !authMode) return
    const newMode = { ...authMode, [field]: value }
    // 防止同时禁用两种模式
    if (!newMode.password && !newMode.pubkey) return
    setAuthModeSaving(true)
    setAuthModeError('')
    try {
      await invoke('server_set_ssh_auth_mode', {
        sessionId,
        passwordEnabled: newMode.password,
        pubkeyEnabled: newMode.pubkey,
      })
      setAuthMode(newMode)
    } catch (error) {
      setAuthModeError(String(error))
      // 恢复原值
      await fetchAuthMode()
    } finally {
      setAuthModeSaving(false)
    }
  }

  // 生成密钥对
  const handleGenerateKey = async () => {
    setKeyGenLoading(true)
    setKeyError('')
    setKeyMessage('')
    try {
      const kp = await invoke<SshKeyPair>('ssh_generate_keypair', { algorithm: keyAlgorithm })
      setKeyPair(kp)
    } catch (e) {
      const message = String(e)
      if (!message.toLowerCase().includes('cancelled')) setKeyError(message)
    } finally {
      setKeyGenLoading(false)
    }
  }

  // 将公钥部署到服务器
  const handleDeployKey = async () => {
    if (!sessionId || !keyPair) return
    setKeyDeployLoading(true)
    setKeyError('')
    setKeyMessage('')
    try {
      const result = await invoke<string>('server_deploy_pubkey', {
        sessionId,
        pubkey: keyPair.public_key_openssh,
      })
      setKeyMessage(result)
    } catch (e) {
      setKeyError(String(e))
    } finally {
      setKeyDeployLoading(false)
    }
  }

  if (!sessionId) return <div className="sp-empty">{t('common.connectFirst')}</div>

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">{t('settings.title')}</h2>

      {/* 设置卡片的网格布局 */}
      <div className="settings-grid">
        {/* 应用设置 - 自动重连 */}
        {appSettings && (
          <div className="settings-card">
            <div className="settings-card-header">{t('settings.appSettings')}</div>
            <div className="settings-card-body">
              <div className="settings-row">
                <span className="settings-label">{t('settings.autoReconnect')}</span>
                <button
                  className={`firewall-toggle ${appSettings.auto_reconnect ? 'on' : 'off'}`}
                  onClick={onToggleAutoReconnect}
                >
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-label">{appSettings.auto_reconnect ? t('common.on') : t('common.off')}</span>
                </button>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('settings.closeTabOnDisconnect')}</span>
                <button
                  className={`firewall-toggle ${appSettings.close_tab_on_disconnect ? 'on' : 'off'}`}
                  onClick={() => onUpdateSettings?.({ close_tab_on_disconnect: !appSettings.close_tab_on_disconnect })}
                >
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-label">{appSettings.close_tab_on_disconnect ? t('common.on') : t('common.off')}</span>
                </button>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('settings.theme')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['dark', 'light'] as const).map(mode => (
                    <button
                      key={mode}
                      className={`svc-cfg-btn ${appSettings.theme === mode ? 'primary' : ''}`}
                      style={{ padding: '4px 14px', fontSize: 12 }}
                      onClick={() => onUpdateSettings?.({ theme: mode })}
                      disabled={!onUpdateSettings}
                    >
                      {mode === 'dark' ? t('settings.dark') : t('settings.light')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="edit-field">
                <label>{t('settings.reconnectInterval')}</label>
                <input
                  type="number"
                  min="1"
                  value={reconnectIntervalInput}
                  onChange={(e) => setReconnectIntervalInput(e.target.value)}
                  className="create-input"
                  disabled={!onUpdateSettings || settingsSaving}
                />
              </div>
              <div className="edit-field">
                <label>{t('settings.maxAttempts')}</label>
                <input
                  type="number"
                  min="1"
                  value={maxAttemptsInput}
                  onChange={(e) => setMaxAttemptsInput(e.target.value)}
                  className="create-input"
                  disabled={!onUpdateSettings || settingsSaving}
                />
              </div>
              <div className="edit-field">
                <label>{t('settings.commandTimeout')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {t('settings.commandTimeoutHint')}</span></label>
                <input
                  type="number"
                  min="1"
                  value={commandTimeoutInput}
                  onChange={(e) => setCommandTimeoutInput(e.target.value)}
                  className="create-input"
                  disabled={!onUpdateSettings || settingsSaving}
                />
              </div>
              <div className="edit-field">
                <label>{t('settings.uploadWorkers')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {t('settings.uploadWorkersHint')}</span></label>
                <input
                  type="number"
                  min="1"
                  value={uploadWorkersInput}
                  onChange={(e) => setUploadWorkersInput(e.target.value)}
                  className="create-input"
                  disabled={!onUpdateSettings || settingsSaving}
                />
              </div>
              {onUpdateSettings && (
                <button
                  className="svc-cfg-btn primary"
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  style={{ marginTop: 8 }}
                >
                  {settingsSaving ? t('common.saving') : t('common.save')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 文件缓存设置 */}
        {appSettings && (
          <div className="settings-card">
            <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{t('settings.fileCache')} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>({cacheCount} {t('settings.directories')})</span></span>
              <button
                className={`firewall-toggle ${appSettings.cache_enabled ? 'on' : 'off'}`}
                onClick={() => onUpdateSettings?.({ cache_enabled: !appSettings.cache_enabled })}
                disabled={!onUpdateSettings}
              >
                <span className="toggle-track"><span className="toggle-thumb" /></span>
                <span className="toggle-label">{appSettings.cache_enabled ? t('common.on') : t('common.off')}</span>
              </button>
            </div>
            <div className="settings-card-body">
              <div className="edit-field">
                <label>{t('settings.cacheTtl')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {t('settings.cacheTtlHint')}</span></label>
                <input
                  type="number"
                  min="1"
                  value={cacheLimitInput}
                  onChange={(e) => setCacheLimitInput(e.target.value)}
                  className="create-input"
                  disabled={!onUpdateSettings || settingsSaving || !appSettings.cache_enabled}
                />
              </div>
              <div className="edit-field">
                <label>{t('settings.maxFilesPerDir')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {t('settings.maxFilesHint')}</span></label>
                <input
                  type="number"
                  min="1"
                  value={cacheMaxFilesInput}
                  onChange={(e) => setCacheMaxFilesInput(e.target.value)}
                  className="create-input"
                  disabled={!onUpdateSettings || settingsSaving || !appSettings.cache_enabled}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {onUpdateSettings && (
                  <button
                    className="svc-cfg-btn primary"
                    onClick={handleSaveSettings}
                    disabled={settingsSaving || !appSettings.cache_enabled}
                  >
                    {settingsSaving ? t('common.saving') : t('common.save')}
                  </button>
                )}
                <button
                  className="svc-cfg-btn"
                  onClick={handleClearCache}
                  disabled={cacheClearing || cacheCount === 0}
                  style={{ background: 'var(--red-strong)', color: '#fff', borderColor: 'var(--red-strong)' }}
                >
                  {cacheClearing ? t('settings.clearing') : t('settings.clearAllCache')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 数据目录 */}
        <div className="settings-card">
          <div className="settings-card-header">{t('settings.dataDirectory')}</div>
          <div className="settings-card-body">
            <div className="settings-row">
              <span className="settings-label">{t('settings.dataDirPath')}</span>
              <span className="settings-value" style={{ wordBreak: 'break-all', textAlign: 'right' }}>
                {dataDir || t('common.loading')}
              </span>
            </div>
            <div className="settings-hint">
              {t('settings.dataDirHint')}
            </div>
            {dirError && <div className="settings-error">{t('settings.openDataDirFailed', { error: dirError })}</div>}
            <div className="settings-btn-row">
              <button
                className="svc-cfg-btn primary"
                onClick={handleOpenDataDir}
                disabled={openingDir || !dataDir}
              >
                {openingDir ? '...' : t('settings.openDataDir')}
              </button>
            </div>
          </div>
        </div>

        {/* 系统信息 */}
        <div className="settings-card">
          <div className="settings-card-header">{t('settings.systemInfo')}</div>
          <div className="settings-card-body">
            <div className="settings-row">
              <span className="settings-label">{t('settings.lastBoot')}</span>
              <span className="settings-value">{bootTime || t('common.loading')}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('settings.uptime')}</span>
              <span className="settings-value">{uptimeDuration || t('common.loading')}</span>
            </div>
          </div>
        </div>

        {/* 服务器重启 */}
        <div className="settings-card">
          <div className="settings-card-header">{t('settings.serverReboot')}</div>
          <div className="settings-card-body">
            <div className="settings-btn-row">
              <button
                className="svc-cfg-btn primary"
                onClick={() => handleReboot(false)}
                disabled={rebootLoading}
              >
                {rebootLoading ? '...' : t('settings.reboot')}
              </button>
              <button
                className="svc-cfg-btn danger"
                onClick={() => handleReboot(true)}
                disabled={rebootLoading}
              >
                {rebootLoading ? '...' : t('settings.forceReboot')}
              </button>
            </div>
            <div className="settings-hint">
              {t('settings.rebootHint')}
            </div>
          </div>
        </div>

        {/* SSH 身份验证 */}
        <div className="settings-card" style={{ gridColumn: 'span 2' }}>
          <div className="settings-card-header">{t('settings.sshAuth')}</div>
          <div className="settings-card-body">
            {/* 身份验证模式切换 */}
            <div className="settings-auth-toggles">
              <div className="settings-row">
                <span className="settings-label">{t('settings.passwordLogin')}</span>
                <button
                  className={`firewall-toggle ${authMode?.password ? 'on' : 'off'} ${authModeSaving ? 'loading' : ''}`}
                  onClick={() => handleToggleAuthMode('password', !authMode?.password)}
                  disabled={authModeSaving || !authMode || (authMode.password && !authMode.pubkey)}
                  title={authMode?.password && !authMode?.pubkey ? 'Cannot disable the last auth method' : ''}
                >
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-label">{authMode?.password ? t('common.on') : t('common.off')}</span>
                </button>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('settings.keyLogin')}</span>
                <button
                  className={`firewall-toggle ${authMode?.pubkey ? 'on' : 'off'} ${authModeSaving ? 'loading' : ''}`}
                  onClick={() => handleToggleAuthMode('pubkey', !authMode?.pubkey)}
                  disabled={authModeSaving || !authMode || (!authMode.password && authMode.pubkey)}
                  title={!authMode?.password && authMode?.pubkey ? 'Cannot disable the last auth method' : ''}
                >
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-label">{authMode?.pubkey ? t('common.on') : t('common.off')}</span>
                </button>
              </div>
            </div>
            {authModeLoading && <div className="settings-muted">{t('settings.loadingAuth')}</div>}
            {authModeError && <div className="settings-muted" style={{ color: 'var(--red)' }}>{authModeError}</div>}

            {/* 密钥生成 */}
            <div className="settings-key-section">
              <div className="settings-section-sub-header">{t('settings.sshKeyManagement')}</div>
              <div className="settings-form-row">
                <select
                  className="settings-select"
                  value={keyAlgorithm}
                  onChange={(e) => { setKeyAlgorithm(e.target.value); setKeyPair(null) }}
                >
                  <option value="ed25519">Ed25519</option>
                </select>
                <button
                  className="svc-cfg-btn primary"
                  onClick={handleGenerateKey}
                  disabled={keyGenLoading}
                >
                  {keyGenLoading ? t('settings.generating') : t('settings.generateKey')}
                </button>
              </div>

              {keyError && <div className="settings-error">{keyError}</div>}
              {keyMessage && <div className="settings-success">{keyMessage}</div>}

              {keyPair && (
                <>
                  <div className="settings-pubkey">
                    <label>{t('settings.publicKey')}</label>
                    <textarea
                      className="settings-pubkey-textarea"
                      readOnly
                      value={keyPair.public_key_openssh}
                      rows={3}
                    />
                    <div className="settings-hint">
                      {t('settings.privateKeySaved', { path: keyPair.private_key_path })}
                    </div>
                  </div>
                  <div className="settings-btn-row">
                    <button
                      className="svc-cfg-btn primary"
                      onClick={handleDeployKey}
                      disabled={keyDeployLoading}
                    >
                      {keyDeployLoading ? '...' : t('settings.deployToServer')}
                    </button>
                  </div>
                  <div className="settings-hint settings-hint-warning">
                    {t('settings.keyGenHint')}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 重启确认对话框 */}
      {rebootConfirm.show && (
        <div className="fb-dialog-overlay">
          <div className="fb-dialog reboot-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close-btn"
              onClick={() => setRebootConfirm({ show: false, force: false })}
              title="关闭"
            >×</button>
            <div className="fb-dialog-title">
              {rebootConfirm.force ? t('settings.forceRebootServer') : t('settings.rebootServer')}
            </div>
            <div className="reboot-confirm-msg">
              {rebootConfirm.force
                ? t('settings.forceRebootConfirmMsg')
                : t('settings.rebootConfirmMsg')}
            </div>
            {rebootConfirm.force && (
              <div className="reboot-confirm-warning">
                <span className="reboot-warning-icon">!</span>
                {t('settings.forceRebootWarning')}
              </div>
            )}
            <div className="fb-dialog-actions">
              <button
                className="fb-dialog-btn"
                onClick={() => setRebootConfirm({ show: false, force: false })}
              >
                {t('common.cancel')}
              </button>
              <button
                className={`fb-dialog-btn ${rebootConfirm.force ? 'danger' : 'primary'}`}
                onClick={execReboot}
              >
                {rebootConfirm.force ? t('settings.forceReboot') : t('settings.reboot')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 命令执行浮动面板 */}
      {rebootExecPanel.show && (
        <div className="reboot-exec-panel">
          <div className="reboot-exec-header">
            <span className="reboot-exec-title">
              {rebootExecPanel.status === 'running' && (
                <>
                  <span className="reboot-exec-spinner" />
                  {t('settings.executing')}
                </>
              )}
              {rebootExecPanel.status === 'done' && (
                <span style={{ color: 'var(--green)' }}>&#10003; {t('settings.completed')}</span>
              )}
              {rebootExecPanel.status === 'error' && (
                <span style={{ color: 'var(--red)' }}>&#10007; Failed</span>
              )}
            </span>
            <button
              className="reboot-exec-close"
              onClick={() => setRebootExecPanel({ show: false, logs: [], status: 'running' })}
            >
              &#10005;
            </button>
          </div>
          <div className="reboot-exec-log">
            {rebootExecPanel.logs.map((line, i) => (
              <div key={i} className={`reboot-exec-log-line ${
                line.startsWith('[CMD]') ? 'cmd' :
                line.startsWith('[OK]') ? 'ok' :
                line.startsWith('[ERROR]') ? 'error' : ''
              }`}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
