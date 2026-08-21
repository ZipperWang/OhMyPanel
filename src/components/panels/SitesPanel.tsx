import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import EditSite from './EditSite'
import ServiceUnavailable from './ServiceUnavailable'

interface SiteInfo {
  domain: string
  domains: string
  root: string
  config_path: string
  ssl: boolean
  ssl_cert_path: string | null
  ssl_key_path: string | null
  php_version: string
  running_dir: string
  open_basedir: boolean
  enabled: boolean
  index_files: string
  proxy_target: string
  hotlink_enabled: boolean
  hotlink_extensions: string
  hotlink_allowed_domains: string
  hotlink_response: string
  hotlink_allow_empty_referer: boolean
  created_at: number
}

interface SitesPanelProps {
  sessionId: string | null
  onOpenFolder?: (path: string) => void
  visible?: boolean
  onNavigateToSoftware?: () => void
}

type View = 'list' | 'create' | 'edit' | 'progress'

export default function SitesPanel({ sessionId, onOpenFolder, visible, onNavigateToSoftware }: SitesPanelProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('list')
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // 搜索
  const [searchQuery, setSearchQuery] = useState('')

  // 删除对话框
  const [deleteTarget, setDeleteTarget] = useState<SiteInfo | null>(null)
  const [removeFiles, setRemoveFiles] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDomain, setConfirmDomain] = useState('')

  // 编辑目标
  const [editTarget, setEditTarget] = useState<SiteInfo | null>(null)

  // 站点创建进度日志（在视图之间共享）
  const [progressLogs, setProgressLogs] = useState<string[]>([])

  const openEdit = (site: SiteInfo) => {
    setEditTarget(site)
    setView('edit')
  }

  // 切换 Toast 通知
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ponytail：nginx 状态标志，true 表示未安装或未运行
  const [nginxDown, setNginxDown] = useState(false)

  const fetchSites = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError('')
    try {
      const [list, softwareList] = await Promise.all([
        invoke<SiteInfo[]>('server_list_sites', { sessionId }),
        invoke<{ name: string; installed: boolean; running: boolean }[]>('server_get_software_list', { sessionId }),
      ])
      // 按创建时间倒序排列（最新的在前），依据配置文件 mtime
      list.sort((a, b) => b.created_at - a.created_at)
      setSites(list)
      // ponytail：检查 nginx 状态，未安装或未运行时显示横幅
      const nginx = softwareList.find(s => s.name.toLowerCase() === 'nginx')
      if (!nginx || !nginx.installed || !nginx.running) {
        setNginxDown(true)
      } else {
        setNginxDown(false)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionId, t])

  // ponytail：挂载时获取数据，并在面板每次变为可见时重新获取
  useEffect(() => {
    if (visible !== false) fetchSites()
  }, [visible, fetchSites])

  // 监听站点创建进度事件（始终保持活动）
  useEffect(() => {
    if (!sessionId) return
    
    const unlisten = listen<{ sessionId: string; domain: string; line: string; status: string }>(
      'site-create-progress',
      (event) => {
        if (event.payload.sessionId === sessionId) {
          setProgressLogs(prev => [...prev, event.payload.line])
        }
      }
    )
    
    return () => {
      unlisten.then(unsub => unsub())
    }
  }, [sessionId])

  // 监听 SSL 安装事件以刷新站点列表
  useEffect(() => {
    if (!sessionId) return
    
    const unlisten = listen<{ sessionId: string; domain: string }>(
      'ssl-installed',
      (event) => {
        if (event.payload.sessionId === sessionId) {
          // 刷新站点列表以更新 SSL 状态
          fetchSites()
        }
      }
    )
    
    return () => {
      unlisten.then(unsub => unsub())
    }
  }, [sessionId, fetchSites])

  const handleDelete = async () => {
    if (!deleteTarget || !sessionId) return
    
    // 验证域名输入（不区分大小写）
    if (confirmDomain.trim().toLowerCase() !== deleteTarget.domain.toLowerCase()) {
      setError('输入的域名与目标域名不匹配')
      setTimeout(() => setError(''), 3000)
      return
    }
    
    setDeleting(true)
    try {
      await invoke('server_delete_site', {
        sessionId,
        domain: deleteTarget.domain,
        removeFiles,
      })
      setMsg(`Site ${deleteTarget.domain} deleted`)
      setDeleteTarget(null)
      setConfirmDomain('')
      fetchSites()
    } catch (e) {
      setError(`Delete failed: ${e}`)
    } finally {
      setDeleting(false)
    }
  }

  const handleToggle = async (site: SiteInfo, enable: boolean) => {
    if (!sessionId) return
    try {
      await invoke<string>('server_toggle_site', {
        sessionId,
        configPath: site.config_path,
        domain: site.domain,
        enable,
      })
      setToast({ type: 'success', text: `${site.domain} ${enable ? 'started' : 'stopped'} successfully` })
      setTimeout(() => setToast(null), 2500)
      fetchSites()
    } catch (e) {
      setToast({ type: 'error', text: `${enable ? 'Start' : 'Stop'} failed: ${e}` })
      setTimeout(() => setToast(null), 3500)
    }
  }

  if (!sessionId) return <div className="sp-empty">{t('common.connectFirst')}</div>

  return (
    <div className="sites-panel">
      <div className="sites-header">
        <h2>{t('sites.title')}</h2>
        {view !== 'create' && (
          <button
            className="svc-cfg-btn primary"
            onClick={() => setView('create')}
          >
            {t('sites.newSite')}
          </button>
        )}
        <div className="sites-header-actions">
          <input
            type="text"
            className="sites-search"
            placeholder={t('sites.searchDomain')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {msg && <span className="sites-msg">{msg}</span>}
          <button
            className="svc-cfg-btn"
            onClick={fetchSites}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </div>

      {error && <div className="svc-error">{error}</div>}

      {/* Nginx 未运行警告横幅 */}
      {nginxDown && view === 'list' && (
        <ServiceUnavailable serviceName="Nginx" onNavigate={onNavigateToSoftware} />
      )}

      {/* 编辑页面 */}
      {view === 'edit' && editTarget ? (
        <EditSite
          sessionId={sessionId!}
          site={editTarget}
          onBack={() => { setView('list'); setEditTarget(null) }}
          onSaved={() => { setView('list'); setEditTarget(null); setMsg('Site updated'); fetchSites() }}
          onError={setError}
        />
      ) : view === 'create' ? (
        <CreateSiteForm
          sessionId={sessionId}
          onError={setError}
          onViewProgress={() => {
            setProgressLogs([])
            setView('progress')
          }}
          onCancel={() => setView('list')}
        />
      ) : view === 'progress' ? (
        <CreateSiteProgress
          logs={progressLogs}
          onBack={() => { setView('list'); setProgressLogs([]); fetchSites() }}
        />
      ) : (
        <>
          {loading && sites.length === 0 ? (
            <div className="svc-loading">{t('sites.loadingSites')}</div>
          ) : sites.length === 0 ? (
            <div className="sites-empty">
              <p>{t('sites.noSites')}</p>
              <button className="svc-cfg-btn primary" onClick={() => setView('create')}>
                {t('sites.createFirst')}
              </button>
            </div>
          ) : (
            <>
              {searchQuery && (
                <div style={{ color: 'var(--red)', marginBottom: '12px', fontSize: '14px' }}>
                  {t('sites.searchResultsHint')}
                </div>
              )}
              <div className="sites-grid">
              {sites
                .filter(s => !searchQuery || s.domain.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((site) => (
                <div className={`site-card ${site.enabled ? 'running' : 'stopped'}`} key={site.config_path}>
                  <div className="site-card-header">
                    <div className="site-domain">
                      <span
                        className="site-domain-text"
                        style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dashed' }}
                        onClick={() => openEdit(site)}
                        title="Click to edit site"
                      >
                        {site.domain}
                      </span>
                      {site.ssl && <span className="site-ssl-badge">SSL</span>}
                    </div>
                  </div>
                  <div className="site-card-body">
                    <div className="site-info-row">
                      <span
                        className="site-info-value mono site-root-link"
                        onClick={() => onOpenFolder?.(site.root)}
                        title="Open in File Browser"
                      >{site.root}</span>
                    </div>
                    {site.php_version && (
                      <div className="site-info-row">
                        <span className="site-info-value">PHP {site.php_version}</span>
                      </div>
                    )}
                  </div>
                  <div className="site-card-actions">
                    <button
                      className="svc-cfg-btn"
                      style={!site.enabled ? { background: 'var(--green-bg)', color: '#fff', border: '1px solid var(--green-strong)' } : {}}
                      onClick={() => handleToggle(site, !site.enabled)}
                    >
                      {site.enabled ? t('common.stop') : t('common.start')}
                    </button>
                    <button className="svc-cfg-btn" style={{ background: 'var(--green-bg)', color: '#fff', border: '1px solid var(--green-strong)' }} onClick={() => openEdit(site)}>
                      {t('common.edit')}
                    </button>
                  </div>
                  {/* 删除按钮，位于右下角 */}
                  <button
                    className="site-delete-btn"
                    onClick={() => { setDeleteTarget(site); setRemoveFiles(false) }}
                    title={t('common.delete')}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              ))}
            </div>
            </>
          )}
        </>
      )}

      {/* 删除确认对话框 */}
      {deleteTarget && (
        <div className="fb-dialog-overlay">
          <div className="fb-dialog fb-delete-site-dialog" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close-btn"
              onClick={() => {
                setDeleteTarget(null)
                setConfirmDomain('')
              }}
              title="关闭"
            >×</button>
            
            {/* 警告页头 */}
            <div className="delete-warning-header">
              <div className="warning-title">
                <h3>{t('sites.deleteSiteTitle', { domain: deleteTarget.domain })}</h3>
                <p>{t('sites.deleteWarning')}</p>
              </div>
            </div>
            
            {/* 信息框 */}
            <div className="delete-info-box">
              {t('sites.deleteInfo', { domain: deleteTarget.domain })}
            </div>
            
            {/* 域名确认输入框 */}
            <div className="confirm-input-section">
              <label className="confirm-label">
                {t('sites.typeDomainConfirm')}
              </label>
              <input
                type="text"
                value={confirmDomain}
                onChange={(e) => setConfirmDomain(e.target.value)}
                placeholder={`Enter: ${deleteTarget.domain}`}
                className="confirm-domain-input"
                autoFocus
              />
              {confirmDomain.trim() && confirmDomain.trim().toLowerCase() !== deleteTarget.domain.toLowerCase() && (
                <div className="input-error-msg">
                  {t('sites.domainMismatch')}
                </div>
              )}
            </div>
            
            {/* 删除文件选项 */}
            <label className="site-delete-files-option enhanced">
              <input
                type="checkbox"
                checked={removeFiles}
                onChange={(e) => setRemoveFiles(e.target.checked)}
              />
              <div className="checkbox-content">
                <span className="checkbox-text">{t('sites.alsoDeleteFiles')}</span>
                <code className="path-code">{deleteTarget.root}</code>
              </div>
            </label>
            
            {/* 操作按钮 */}
            <div className="fb-dialog-actions">
              <button 
                className="fb-dialog-btn cancel-btn"
                onClick={() => {
                  setDeleteTarget(null)
                  setConfirmDomain('')
                }} 
                disabled={deleting}
              >
                {t('common.cancel')}
              </button>
              <button 
                className="fb-dialog-btn danger delete-btn"
                onClick={handleDelete} 
                disabled={deleting || !confirmDomain.trim() || confirmDomain.trim().toLowerCase() !== deleteTarget.domain.toLowerCase()}
              >
                {deleting ? t('common.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 切换 Toast 通知 */}
      {toast && (
        <div className={`toast-notification toast-${toast.type}`} onClick={() => setToast(null)}>
          <span className="toast-icon">{toast.type === 'success' ? '✓' : '✕'}</span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
    </div>
  )
}

interface CreateSiteFormProps {
  sessionId: string
  onError: (msg: string) => void
  onViewProgress?: () => void
  onCancel?: () => void
}

function CreateSiteForm({
  sessionId,
  onError,
  onViewProgress,
  onCancel,
}: CreateSiteFormProps) {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [root, setRoot] = useState('')
  const [phpVersion, setPhpVersion] = useState('')
  const [phpVersions, setPhpVersions] = useState<string[]>([])
  const [useSsl, setUseSsl] = useState(false)
  const [creating, setCreating] = useState(false)

  // Nginx 安装提示对话框（未使用，为将来保留）
  const [_showNginxPrompt, _setShowNginxPrompt] = useState(false)
  const [createDb, setCreateDb] = useState(false)
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPass, setDbPass] = useState('')

  const domainToIdent = (d: string) => d.replace(/[.-]/g, '_')

  useEffect(() => {
    invoke<string[]>('server_list_php_versions', { sessionId }).then(setPhpVersions).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    if (domain) {
      if (!root || root === `/www/wwwroot/${domain}`) {
        setRoot(`/www/wwwroot/${domain}`)
      }
      const ident = domainToIdent(domain)
      setDbName(ident)
      setDbUser(ident)
    }
  }, [domain])

  const handleCreate = async () => {
    if (!domain.trim()) {
      onError('Please enter a domain name')
      return
    }
    
    // 创建站点前检查是否已安装 Nginx
    try {
      const softwareList = await invoke<any[]>('server_get_software_list', { sessionId })
      const nginx = softwareList.find(s => s.name === 'nginx' || s.name === 'Nginx')
      if (!nginx || !nginx.installed) {
        onError(t('sites.nginxNotInstalled'))
        return
      }
    } catch (e) {
      // 检查失败时继续创建（交由后端处理）
      console.error('Failed to check Nginx status:', e)
    }
    
    setCreating(true)
    try {
      // 开始创建前切换到进度视图
      onViewProgress?.()
      
      const result = await invoke<string>('server_create_site', {
        sessionId,
        domain: domain.trim(),
        root: root.trim() || `/www/wwwroot/${domain.trim()}`,
        phpVersion,
        runningDir: '/',
        openBasedir: true,
        useSsl,
        createDb,
        dbName: createDb ? dbName.trim() : '',
        dbUser: createDb ? dbUser.trim() : '',
        dbPass: createDb ? dbPass : '',
      })
      // 显示结果（可能是带 SSL 警告的部分成功）
      if (result.includes('but SSL') || result.includes('but database')) {
        onError(result)
      }
      // 不自动跳转，停留在进度页面供用户查看
    } catch (e) {
      const errMsg = String(e)
      // 检查错误是否与 nginx 未安装有关
      if (errMsg.toLowerCase().includes('nginx') && errMsg.toLowerCase().includes('install')) {
        _setShowNginxPrompt(true)
        // ponytail：已移除 LNMP 安装功能，仅显示提示，不自动导航
      } else {
        onError(errMsg)
      }
    } finally {
      setCreating(false)
    }
  }

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
    let pw = ''
    const arr = new Uint32Array(16)
    crypto.getRandomValues(arr)
    for (let i = 0; i < 16; i++) pw += chars[arr[i] % chars.length]
    setDbPass(pw)
  }

  return (
    <div className="create-site-form">
      <div className="create-site-title">{t('sites.createNewSite')}</div>

      <div className="create-field">
        <label>{t('sites.domainName')}</label>
        <input
          type="text"
          className="create-input"
          placeholder="example.com"
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value)
            if (e.target.value) {
              setRoot(`/www/wwwroot/${e.target.value}`)
              const ident = e.target.value.replace(/[.-]/g, '_')
              setDbName(ident)
              setDbUser(ident)
            }
          }}
        />
      </div>

      <div className="create-field">
        <label>{t('sites.webRoot')}</label>
        <input
          type="text"
          className="create-input"
          placeholder={`/www/wwwroot/${domain || 'example.com'}`}
          value={root}
          onChange={(e) => setRoot(e.target.value)}
        />
      </div>

      <div className="create-field">
        <label>{t('sites.phpVersion')}</label>
        <select
          className="create-select"
          value={phpVersion}
          onChange={(e) => setPhpVersion(e.target.value)}
        >
          <option value="">{t('sites.noneStatic')}</option>
          {phpVersions.map(v => (
            <option key={v} value={v}>PHP {v}</option>
          ))}
        </select>
      </div>

      <label className="create-checkbox">
        <input
          type="checkbox"
          checked={useSsl}
          onChange={(e) => setUseSsl(e.target.checked)}
        />
        <span>{t('sites.enableSsl')}</span>
      </label>

      <label className="create-checkbox">
        <input
          type="checkbox"
          checked={createDb}
          onChange={(e) => setCreateDb(e.target.checked)}
        />
        <span>{t('sites.createMysqlDb')}</span>
      </label>

      {createDb && (
        <div className="create-db-fields">
          <div className="create-field">
            <label>{t('sites.dbName')}</label>
            <input
              type="text"
              className="create-input"
              placeholder="database_name"
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
            />
          </div>
          <div className="create-field">
            <label>{t('sites.dbUser')}</label>
            <input
              type="text"
              className="create-input"
              placeholder="db_user"
              value={dbUser}
              onChange={(e) => setDbUser(e.target.value)}
            />
          </div>
          <div className="create-field">
            <label>{t('sites.dbPassword')}</label>
            <div className="create-input-row">
              <input
                type="text"
                className="create-input"
                placeholder="password"
                value={dbPass}
                onChange={(e) => setDbPass(e.target.value)}
              />
              <button className="create-gen-btn" type="button" onClick={generatePassword} title="Generate random password">
                &#x21bb;
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          className="install-btn"
          onClick={handleCreate}
          disabled={creating || !domain.trim()}
        >
          {creating ? t('sites.creating') : t('sites.createSite')}
        </button>
        <button
          className="install-btn secondary"
          onClick={() => onCancel?.()}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

// 进度显示页面（类似 SoftwareRepo）
function CreateSiteProgress({
  logs,
  onBack,
}: {
  logs: string[]
  onBack: () => void
}) {
  const { t } = useTranslation()
  const logEndRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // 仅在创建完成或发生错误时显示返回按钮
  const hasError = logs.some(line => line.includes('ERROR') || line.includes('failed'))
  const isComplete = logs.length > 0 && !hasError && logs.some(line => line.toLowerCase().includes('successfully') || line.toLowerCase().includes('completed'))
  const showBackButton = isComplete || hasError

  // 检查一行是否应以红色显示（错误或警告消息）
  const isErrorLine = (line: string) => {
    return line.includes('ERROR') || 
           line.includes('failed') || 
           line.includes('NOT installed') || 
           line.includes('Install it first')
  }

  return (
    <div className="sw-running">
      <div className="sw-running-header">
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{t('sites.siteCreationProgress')}</h2>
      </div>
      <div className="sw-log-box">
        {logs.length === 0 ? (
          <div className="sw-log-line">{t('sites.startingCreation')}</div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={`sw-log-line ${isErrorLine(line) ? 'error' : ''}`}>
              {line}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
      {showBackButton && (
        <button className="sw-action-btn primary" onClick={onBack}>
          {t('sites.backToList')}
        </button>
      )}
    </div>
  )
}
