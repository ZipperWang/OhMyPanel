import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { useTranslation } from 'react-i18next'
import Sidebar from './components/Sidebar'
import ServerPanel, { type PanelSection } from './components/ServerPanel'
import type { TerminalHandle } from './components/Terminal'
import TerminalTabStrip from './components/terminal/TerminalTabStrip'
import { parseConnectionHost } from './components/terminal/terminalActions'
import type { TerminalConnectionState, TerminalDimensions, TerminalSavedConnection, TerminalSessionTabModel } from './components/terminal/types'
import './App.css'

interface UploadItem {
  file: File
  fileName: string
  remotePath: string
  status: 'pending' | 'uploading' | 'done' | 'error' | 'stopped'
  error?: string
  retryCount?: number
}

interface UploadState {
  queue: UploadItem[]
  totalBytes: number
  uploadedBytes: number
  speed: number
  active: boolean
  paused: boolean
  workers: number
}

interface SidebarConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: string
  key_path?: string
  password?: string
  remember_me?: boolean
}

interface Settings {
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

interface ActiveSession {
  configId: string
  sessionId: string | null
  name: string
  hostKey: string
  username: string
  initialSection: PanelSection
}

interface HostKeyVerification {
  kind: 'unknown' | 'changed'
  host: string
  port: number
  algorithm: string
  fingerprint: string
  keyBase64: string
  expectedFingerprint?: string
}

const parseHostKeyVerification = (error: unknown): HostKeyVerification | null => {
  const message = String(error)
  const marker = 'HOST_KEY_VERIFICATION:'
  const markerIndex = message.indexOf(marker)
  if (markerIndex < 0) return null
  try {
    const parsed = JSON.parse(message.slice(markerIndex + marker.length)) as HostKeyVerification
    if (
      (parsed.kind === 'unknown' || parsed.kind === 'changed') &&
      typeof parsed.host === 'string' &&
      typeof parsed.port === 'number' &&
      typeof parsed.algorithm === 'string' &&
      typeof parsed.fingerprint === 'string' &&
      typeof parsed.keyBase64 === 'string'
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function App() {
  const { t } = useTranslation()
  // ponytail：多会话模式：sessions 数组加活动标签页，后端已支持 N 个并发 SSH 连接
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
  // ponytail：跟踪哪些会话拥有活动 SSH 连接（与标签页是否存在解耦）
  const [connectedConfigIds, setConnectedConfigIds] = useState<Set<string>>(new Set())
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [showWelcome, setShowWelcome] = useState(false)
  const termRefMap = useRef(new Map<string, TerminalHandle | null>())
  const activeTermRef = useRef<TerminalHandle | null>(null)
  const [errorDialog, setErrorDialog] = useState<{ visible: boolean; message: string; type: 'auth' | 'network' | 'connection' | 'other' } | null>(null)
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const [connectionErrors, setConnectionErrors] = useState<Map<string, { type: 'auth' | 'network' | 'connection' | 'other'; message: string }>>(new Map())
  const [sessionSections, setSessionSections] = useState<Map<string, PanelSection>>(new Map())
  const [terminalDimensions, setTerminalDimensions] = useState<Map<string, TerminalDimensions>>(new Map())
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set())
  const [newConnectionRequestId, setNewConnectionRequestId] = useState(0)
  const [editConnectionRequest, setEditConnectionRequest] = useState<{ id: string; requestId: number } | null>(null)

  // 设置
  const [settings, setSettings] = useState<Settings>({
    auto_reconnect: true, reconnect_interval: 5, max_reconnect_attempts: 10, close_tab_on_disconnect: false, cache_ttl_hours: 24, cache_max_files: 500, cache_enabled: true, command_timeout_minutes: 30, upload_workers: 3, theme: 'light'
  })

  // 主题变化时应用到 <html data-theme>（同时覆盖初始加载）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme || 'light')
  }, [settings.theme])
  // ponytail：每个会话独立维护重连状态，每台服务器分别重连
  // ponytail：Map 的值存储 { name, attempt }，使重连提示条渲染时不会出现 Toast 闪烁
  const [reconnectingSessions, setReconnectingSessions] = useState<Map<string, { name: string; attempt: number }>>(new Map())
  const reconnectingActiveRef = useRef(new Map<string, boolean>())
  const reconnectAttemptRef = useRef(new Map<string, number>())
  const reconnectTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const reconnectGenerationRef = useRef(new Map<string, number>())
  const connectingIdsRef = useRef(new Set<string>())
  const autoReconnectRef = useRef(true)
  // ponytail：为 close_tab_on_disconnect 保存 ref，避免 useEffect 处理器使用过期闭包
  const closeTabOnDisconnectRef = useRef(false)
  const manualDisconnectSessionsRef = useRef(new Set<string>())
  const replacingSessionsRef = useRef(new Set<string>())
  // ponytail：主动发起正常重启的会话，在断开时跳过自动重连
  const normalRebootSessionsRef = useRef(new Set<string>())
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const sessionsRef = useRef<ActiveSession[]>([])
  const settingsRef = useRef(settings)

  sessionsRef.current = sessions
  settingsRef.current = settings

  const activeSession = sessions.find(s => s.configId === activeConfigId) || null
  const activeSessionId = activeSession?.sessionId ?? null
  const activePanelSection = activeConfigId
    ? sessionSections.get(activeConfigId) || activeSession?.initialSection || 'dashboard'
    : 'dashboard'
  // ponytail：活动标签页已断开且未重连，显示持久提示
  const isDisconnected = activeConfigId
    ? !connectedConfigIds.has(activeConfigId) &&
      !reconnectingSessions.has(activeConfigId) &&
      !connectingIdsRef.current.has(activeConfigId) &&
      connectingServerId !== activeConfigId
    : false

  const markDisconnected = (configId: string) => {
    setConnectedConfigIds(prev => { const s = new Set(prev); s.delete(configId); return s })
  }

  const clearReconnectState = (configId: string) => {
    const timer = reconnectTimersRef.current.get(configId)
    if (timer) clearTimeout(timer)
    reconnectTimersRef.current.delete(configId)
    reconnectingActiveRef.current.delete(configId)
    reconnectAttemptRef.current.delete(configId)
    setReconnectingSessions(prev => {
      if (!prev.has(configId)) return prev
      const next = new Map(prev)
      next.delete(configId)
      return next
    })
  }

  const handleDisconnectAction = (configId: string) => {
    if (closeTabOnDisconnectRef.current) removeSession(configId)
    else markDisconnected(configId)
  }

  const removeSession = (configId: string) => {
    clearReconnectState(configId)
    connectingIdsRef.current.delete(configId)
    termRefMap.current.delete(configId)
    const current = sessionsRef.current
    const removedIndex = current.findIndex(session => session.configId === configId)
    const remaining = current.filter(session => session.configId !== configId)
    sessionsRef.current = remaining
    setSessions(remaining)
    setConnectedConfigIds(prev => { const s = new Set(prev); s.delete(configId); return s })
    setActiveConfigId(prev => {
      if (prev !== configId) return prev
      if (remaining.length === 0) return null
      return remaining[Math.min(Math.max(removedIndex, 0), remaining.length - 1)].configId
    })
    setConnectionErrors(prev => { const next = new Map(prev); next.delete(configId); return next })
    setSessionSections(prev => { const next = new Map(prev); next.delete(configId); return next })
    setTerminalDimensions(prev => { const next = new Map(prev); next.delete(configId); return next })
    setUnreadSessions(prev => { const next = new Set(prev); next.delete(configId); return next })
  }

  const closeSession = (configId: string) => {
    const session = sessionsRef.current.find(item => item.configId === configId)
    if (session?.sessionId) {
      manualDisconnectSessionsRef.current.add(session.sessionId)
      invoke('ssh_disconnect', { sessionId: session.sessionId }).catch(() => {})
    }
    removeSession(configId)
  }

  useEffect(() => {
    activeTermRef.current = activeConfigId ? (termRefMap.current.get(activeConfigId) ?? null) : null
    if (activeConfigId) {
      setUnreadSessions(prev => {
        if (!prev.has(activeConfigId)) return prev
        const next = new Set(prev)
        next.delete(activeConfigId)
        return next
      })
    }
  }, [activeConfigId])

  // 可拖动分隔线
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const draggingRef = useRef<'sidebar' | null>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handleDisconnectRequest = (e: Event) => {
      const configId = (e as CustomEvent).detail?.configId
      const sess = sessionsRef.current.find(s => s.configId === configId)
      if (!sess) return
      if (!sess.sessionId) {
        handleDisconnectAction(configId)
        return
      }
      manualDisconnectSessionsRef.current.add(sess.sessionId)
      const doRemove = () => {
        handleDisconnectAction(configId)
      }
      Promise.race([
        invoke('ssh_disconnect', { sessionId: sess.sessionId }).catch(() => {}),
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]).then(doRemove)
    }
    window.addEventListener('sidebar-disconnect', handleDisconnectRequest)
    return () => window.removeEventListener('sidebar-disconnect', handleDisconnectRequest)
  }, [])

  // 上传队列状态
  const [upload, setUpload] = useState<UploadState>({
    queue: [], totalBytes: 0, uploadedBytes: 0, speed: 0, active: false, paused: false, workers: 0
  })
  const uploadPauseRef = useRef(false)
  const uploadStopRef = useRef(false)
  const uploadCompleteRef = useRef<(() => void) | null>(null)

    // ponytail：在浏览器中构建 POSIX tar 归档，无需依赖
  const createTar = async (entries: { name: string; file: File }[]): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = []
    for (const { name, file } of entries) {
      const data = new Uint8Array(await file.arrayBuffer())
      const header = new Uint8Array(512)
      const enc = new TextEncoder()
      header.set(enc.encode(name), 0)
      header.set(enc.encode('0000644\0'), 100)  // 模式
      header.set(enc.encode('0001000\0'), 108)  // uid
      header.set(enc.encode('0001000\0'), 116)  // gid
      header.set(enc.encode(file.size.toString(8).padStart(11, '0') + '\0'), 124)
      header.set(enc.encode(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0'), 136)
      header.set(enc.encode('        '), 148) // 校验和占位符（空格）
      header[156] = 0x30 // 类型 '0' = 普通文件
      header.set(enc.encode('ustar\0'), 257)
      header.set(enc.encode('00'), 263)
      // 计算校验和
      let cksum = 0
      for (let i = 0; i < 512; i++) cksum += header[i]
      header.set(enc.encode(cksum.toString(8).padStart(6, '0') + '\0 '), 148)
      chunks.push(header)
      chunks.push(data)
      const padLen = (512 - (data.length % 512)) % 512
      if (padLen > 0) chunks.push(new Uint8Array(padLen))
    }
    chunks.push(new Uint8Array(1024)) // 终止符
    const total = chunks.reduce((s, c) => s + c.length, 0)
    const result = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { result.set(c, off); off += c.length }
    return result
  }

  const handleStartUpload = useCallback(async (files: { file: File; fileName: string; remotePath: string }[]) => {
    if (!activeSessionId || files.length === 0) return
    const sid = activeSessionId
    const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0)
    const retryCounts = new Map<string, number>()
    const queue: UploadItem[] = files.map(f => ({ ...f, status: 'pending' as const, retryCount: 0 }))
    setUpload({ queue, totalBytes, uploadedBytes: 0, speed: 0, active: true, paused: false, workers: 0 })
    uploadPauseRef.current = false
    uploadStopRef.current = false

    let uploadedBytes = 0
    let activeWorkers = 0
    const startTime = Date.now()
    const CHUNK_SIZE = 1024 * 1024
    // ponytail：小于 1 MB 的文件进入 tar 批处理；大文件使用分块工作器
    const SMALL_THRESHOLD = CHUNK_SIZE

    const updateSpeed = () => {
      const elapsed = (Date.now() - startTime) / 1000
      const speed = elapsed > 0 ? uploadedBytes / elapsed : 0
      setUpload(prev => ({ ...prev, uploadedBytes, speed, workers: activeWorkers }))
    }

    // ponytail：按父目录将小文件批量打包为 tar 归档，N 次 SFTP 操作减少为每个目录 1 次
    // ponytail：单个文件始终使用分块上传，tar 批处理仅用于 2 个及以上的小文件
    const smallFiles: typeof files = []
    const largeFiles: typeof files = []
    for (const f of files) {
      if (f.file.size < SMALL_THRESHOLD && f.file.size > 0) smallFiles.push(f)
      else largeFiles.push(f)
    }
    if (smallFiles.length === 1) {
      largeFiles.push(...smallFiles)
      smallFiles.length = 0
    }

    if (smallFiles.length > 1) {
      // 按父目录分组
      const byDir = new Map<string, typeof files>()
      for (const f of smallFiles) {
        const parent = f.remotePath.substring(0, f.remotePath.lastIndexOf('/'))
        if (!byDir.has(parent)) byDir.set(parent, [])
        byDir.get(parent)!.push(f)
      }

      // 以并发数 3 处理目录
      const dirEntries = [...byDir.entries()]
      let dirIdx = 0
      const batchWorker = async () => {
        activeWorkers++
        updateSpeed()
        try {
        while (dirIdx < dirEntries.length) {
          if (uploadStopRef.current) return
          const i = dirIdx++
          const [parentDir, dirFiles] = dirEntries[i]

          // 将批次标记为上传中
          const indices = dirFiles.map(df => queue.indexOf(queue.find(q => q.remotePath === df.remotePath)!))
          setUpload(prev => ({
            ...prev,
            queue: prev.queue.map((q, j) => indices.includes(j) ? { ...q, status: 'uploading' } : q)
          }))

          try {
            const tarEntries = dirFiles.map(f => ({
              name: f.fileName.split('/').pop()!, // 仅使用文件名，在目标目录中解压
              file: f.file,
            }))
            const tarData = await createTar(tarEntries)
            const tarPath = `${parentDir}/.__tb_${Date.now()}_${i}.tar`

            // 分块上传 tar
            let offset = 0
            while (offset < tarData.length) {
              if (uploadStopRef.current) return
              const end = Math.min(offset + CHUNK_SIZE, tarData.length)
              const chunk = tarData.slice(offset, end)
              await invoke('ssh_upload_chunk', {
                sessionId: sid, remotePath: tarPath, data: chunk, offset,
              })
              uploadedBytes += (end - offset)
              offset = end
              updateSpeed()
            }

            // 解压并清理
            const escaped = (s: string) => s.replace(/'/g, "'\\''")
            const cmd = `cd '${escaped(parentDir)}' && tar xf '${escaped(tarPath.split('/').pop()!)}' && rm -f '${escaped(tarPath.split('/').pop()!)}'`
            const result = await invoke<[string, string, number]>('ssh_exec', { sessionId: sid, command: cmd })
            if (result[2] !== 0) throw new Error(`tar extract failed: ${result[1]}`)

            setUpload(prev => ({
              ...prev,
              queue: prev.queue.map((q, j) => indices.includes(j) ? { ...q, status: 'done' } : q)
            }))
          } catch (err) {
            if (uploadStopRef.current) return
            // ponytail：标记错误前，每个文件最多自动重试 3 次
            const canRetry = dirFiles.every(f => (retryCounts.get(f.remotePath) || 0) < 3)
            if (canRetry) {
              dirFiles.forEach(f => retryCounts.set(f.remotePath, (retryCounts.get(f.remotePath) || 0) + 1))
              await invoke('ssh_sftp_reset', { sessionId: sid }).catch(() => {})
              await new Promise(r => setTimeout(r, 1000))
              if (uploadStopRef.current) return
              setUpload(prev => ({
                ...prev,
                queue: prev.queue.map((q, j) => indices.includes(j) ? { ...q, status: 'pending' as const, retryCount: retryCounts.get(q.remotePath) || 0 } : q)
              }))
              dirEntries.push([parentDir, dirFiles])
            } else {
              setUpload(prev => ({
                ...prev,
                queue: prev.queue.map((q, j) => indices.includes(j) ? { ...q, status: 'error', error: String(err), retryCount: retryCounts.get(q.remotePath) || 0 } : q)
              }))
            }
          }
        }
        } finally { activeWorkers--; updateSpeed() }
      }
      const batchWorkers = Array.from({ length: Math.min(settings.upload_workers || 3, dirEntries.length) }, () => batchWorker())
      await Promise.all(batchWorkers)
    }

    if (uploadStopRef.current) return

    // ponytail：大文件和零字节文件通过分块工作器处理
    const largeQueue: UploadItem[] = largeFiles.map(f => ({ ...f, status: 'pending' as const }))
    if (largeQueue.length > 0) {
      // 更新主队列，仅保留剩余的大文件
      setUpload(prev => ({
        ...prev,
        queue: prev.queue.map(q => {
          const inLarge = largeFiles.some(lf => lf.remotePath === q.remotePath)
          return inLarge ? { ...q, status: 'pending' as const } : q
        })
      }))

      const CONCURRENCY = Math.min(settings.upload_workers || 3, largeQueue.length)
      let nextIndex = 0

      const worker = async () => {
        activeWorkers++
        updateSpeed()
        try {
        while (true) {
          if (uploadStopRef.current) return
          const i = nextIndex++
          if (i >= largeQueue.length) return
          const item = largeQueue[i]

          setUpload(prev => ({
            ...prev,
            queue: prev.queue.map(q => q.remotePath === item.remotePath ? { ...q, status: 'uploading' } : q)
          }))

          try {
            let offset = 0
            while (offset < item.file.size) {
              if (uploadStopRef.current) return
              while (uploadPauseRef.current) {
                if (uploadStopRef.current) return
                await new Promise(r => setTimeout(r, 100))
              }

              const end = Math.min(offset + CHUNK_SIZE, item.file.size)
              const slice = item.file.slice(offset, end)
              const buffer = await slice.arrayBuffer()
              const chunkData = new Uint8Array(buffer)
              try {
                await invoke('ssh_upload_chunk', {
                  sessionId: sid,
                  remotePath: item.remotePath,
                  data: chunkData,
                  offset,
                })
              } catch (_chunkErr) {
                if (uploadStopRef.current) return
                await invoke('ssh_sftp_reset', { sessionId: sid }).catch(() => {})
                await new Promise(r => setTimeout(r, 500))
                if (uploadStopRef.current) return
                await invoke('ssh_upload_chunk', {
                  sessionId: sid,
                  remotePath: item.remotePath,
                  data: chunkData,
                  offset,
                })
              }
              uploadedBytes += (end - offset)
              offset = end
              updateSpeed()
            }
            setUpload(prev => ({
              ...prev,
              queue: prev.queue.map(q => q.remotePath === item.remotePath ? { ...q, status: 'done' } : q)
            }))
          } catch (err) {
            if (uploadStopRef.current) return
            // ponytail：标记错误前最多自动重试 3 次
            const count = (retryCounts.get(item.remotePath) || 0) + 1
            retryCounts.set(item.remotePath, count)
            if (count < 3) {
              await invoke('ssh_sftp_reset', { sessionId: sid }).catch(() => {})
              await new Promise(r => setTimeout(r, 1000))
              if (uploadStopRef.current) return
              setUpload(prev => ({
                ...prev,
                queue: prev.queue.map(q => q.remotePath === item.remotePath ? { ...q, status: 'pending' as const, retryCount: count } : q)
              }))
              largeQueue.push(item)
            } else {
              setUpload(prev => ({
                ...prev,
                queue: prev.queue.map(q => q.remotePath === item.remotePath ? { ...q, status: 'error', error: String(err), retryCount: count } : q)
              }))
            }
          }
        }
        } finally { activeWorkers--; updateSpeed() }
      }

      const workers = Array.from({ length: CONCURRENCY }, () => worker())
      await Promise.all(workers)
    }

    if (!uploadStopRef.current) {
      setUpload(prev => ({ ...prev, active: false, paused: false }))
      uploadCompleteRef.current?.()
    }
  }, [activeSessionId, settings.upload_workers])

  const handlePauseUpload = useCallback(() => {
    uploadPauseRef.current = true
    setUpload(prev => ({ ...prev, paused: true }))
  }, [])

  const handleResumeUpload = useCallback(() => {
    uploadPauseRef.current = false
    setUpload(prev => ({ ...prev, paused: false }))
  }, [])

  // ponytail：停止操作会立即清空 UI，并通知工作器静默退出
  const handleStopUpload = useCallback(() => {
    uploadStopRef.current = true
    uploadPauseRef.current = false
    setUpload({ queue: [], totalBytes: 0, uploadedBytes: 0, speed: 0, active: false, paused: false, workers: 0 })
  }, [])

  const handleDismissUpload = useCallback(() => {
    if (upload.active) return
    setUpload({ queue: [], totalBytes: 0, uploadedBytes: 0, speed: 0, active: false, paused: false, workers: 0 })
  }, [upload.active])

  // ponytail：只重试失败文件，通过相同的上传流程将它们重新加入队列
  const handleRetryFailed = useCallback(() => {
    const failed = upload.queue.filter(q => q.status === 'error')
    if (failed.length === 0) return
    handleStartUpload(failed.map(f => ({ file: f.file, fileName: f.fileName, remotePath: f.remotePath })))
    // handleStartUpload 会创建新的 retryCounts 映射，因此重试次数会重置为 0
  }, [upload.queue, handleStartUpload])

  const [jumpToPath, setJumpToPath] = useState<string | null>(null)

  const handleCreateConnection = async (data: { name: string; host: string; port: number; username: string; auth_type: string; key_path?: string; password?: string; remember_me?: boolean }) => {
  // 保存新连接
    await invoke('config_save', {
      connection: {
        id: Date.now().toString(),
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        auth_type: data.auth_type,
        key_path: data.key_path,
        password: data.password,
        remember_me: data.remember_me || false,
      },
    })
    setSidebarRefreshKey(k => k + 1)
  }

  const handleUpdateSettings = async (updates: Partial<Settings>) => {
    const newSettings = { ...settings, ...updates }
    setSettings(newSettings)
    autoReconnectRef.current = newSettings.auto_reconnect
    closeTabOnDisconnectRef.current = newSettings.close_tab_on_disconnect
    await invoke('settings_save', { settings: newSettings }).catch(() => {})
  }


  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (draggingRef.current === 'sidebar') {
        const w = Math.max(150, Math.min(500, e.clientX))
        setSidebarWidth(w)
      }
    }
    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const startDrag = (type: 'sidebar') => {
    draggingRef.current = type
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // 挂载时加载设置
  useEffect(() => {
    invoke<Settings>('settings_load').then(s => {
      setSettings(s)
      autoReconnectRef.current = s.auto_reconnect
      closeTabOnDisconnectRef.current = s.close_tab_on_disconnect ?? false
    }).catch(() => {})
    // ponytail：启动时自动检查更新，下载前先询问用户
    Promise.race([
      check(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
    ]).then(async update => {
      if (update?.available) {
        const { ask } = await import('@tauri-apps/plugin-dialog')
        const yes = await ask(`New version ${update.version} available. Update now?`, { title: 'Update Available', kind: 'info' })
        if (yes) {
          showToast(`Downloading v${update.version}...`)
          try {
            await update.download()
            const restart = await ask(`v${update.version} has been downloaded. Restart now to apply the update?`, { title: 'Update Ready', kind: 'info' })
            if (restart) {
              await update.install()
            } else {
              setPendingUpdate(update)
              showToast('Update ready. Click "Restart Now" when you are ready.')
            }
          } catch (e) {
            showToast(`Update failed: ${String(e).slice(0, 80)}`)
          }
        }
      }
    }).catch(() => {})
  }, [])

  const toggleAutoReconnect = async () => {
    const newSettings = { ...settings, auto_reconnect: !settings.auto_reconnect }
    setSettings(newSettings)
    autoReconnectRef.current = newSettings.auto_reconnect
    closeTabOnDisconnectRef.current = newSettings.close_tab_on_disconnect
    await invoke('settings_save', { settings: newSettings }).catch(() => {})
  }

  useEffect(() => {
    autoReconnectRef.current = settings.auto_reconnect
    closeTabOnDisconnectRef.current = settings.close_tab_on_disconnect
  }, [settings.auto_reconnect, settings.close_tab_on_disconnect])

  const startReconnect = (session: ActiveSession, delayMs: number) => {
    const sid = session.sessionId
    if (!sid || reconnectingActiveRef.current.get(session.configId)) return
    const generation = (reconnectGenerationRef.current.get(session.configId) ?? 0) + 1
    reconnectGenerationRef.current.set(session.configId, generation)
    reconnectingActiveRef.current.set(session.configId, true)
    reconnectAttemptRef.current.set(session.configId, 0)
    markDisconnected(session.configId)
    setConnectionErrors(prev => { const next = new Map(prev); next.delete(session.configId); return next })
    setReconnectingSessions(prev => new Map(prev).set(session.configId, { name: session.name, attempt: 0 }))

    const attemptReconnect = async () => {
      if (!reconnectingActiveRef.current.get(session.configId) || reconnectGenerationRef.current.get(session.configId) !== generation) return
      const currentSettings = settingsRef.current
      const attempt = (reconnectAttemptRef.current.get(session.configId) ?? 0) + 1
      reconnectAttemptRef.current.set(session.configId, attempt)
      setReconnectingSessions(prev => new Map(prev).set(session.configId, { name: session.name, attempt }))
      try {
        await invoke('ssh_reconnect', { sessionId: sid })
        if (!reconnectingActiveRef.current.get(session.configId) || reconnectGenerationRef.current.get(session.configId) !== generation) {
          manualDisconnectSessionsRef.current.add(sid)
          await invoke('ssh_disconnect', { sessionId: sid }).catch(() => {})
          return
        }
        clearReconnectState(session.configId)
        setConnectedConfigIds(prev => new Set(prev).add(session.configId))
        showToast(`[${session.name}] ${t('common.reconnectSuccess', { attempt })}`)
      } catch {
        if (!reconnectingActiveRef.current.get(session.configId) || reconnectGenerationRef.current.get(session.configId) !== generation) return
        if (attempt >= currentSettings.max_reconnect_attempts) {
          clearReconnectState(session.configId)
          showToast(`[${session.name}] ${t('common.reconnectFailed', { max: currentSettings.max_reconnect_attempts })}`)
          handleDisconnectAction(session.configId)
          return
        }
        const timer = setTimeout(attemptReconnect, currentSettings.reconnect_interval * 1000)
        reconnectTimersRef.current.set(session.configId, timer)
      }
    }

    const timer = setTimeout(attemptReconnect, delayMs)
    reconnectTimersRef.current.set(session.configId, timer)
  }

  useEffect(() => {
    const unlisten = listen<{ sessionId: string; reason: string }>('ssh-disconnected', event => {
      const sid = event.payload.sessionId
      const sess = sessionsRef.current.find(s => s.sessionId === sid)
      if (!sess) return
      markDisconnected(sess.configId)
      if (replacingSessionsRef.current.has(sid)) {
        replacingSessionsRef.current.delete(sid)
        return
      }
      if (manualDisconnectSessionsRef.current.has(sid)) {
        manualDisconnectSessionsRef.current.delete(sid)
        handleDisconnectAction(sess.configId)
        return
      }
      if (normalRebootSessionsRef.current.has(sid)) {
        normalRebootSessionsRef.current.delete(sid)
        showToast(`ℹ [${sess.name}] ${t('common.normalRebootHint')}`)
        handleDisconnectAction(sess.configId)
        return
      }
      if (autoReconnectRef.current) {
        startReconnect(sess, settingsRef.current.reconnect_interval * 1000)
      } else if (!autoReconnectRef.current) {
        showToast(`[${sess.name}] ${t('common.connectionLost')}`)
        handleDisconnectAction(sess.configId)
      }
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [])

  useEffect(() => () => {
    for (const timer of reconnectTimersRef.current.values()) clearTimeout(timer)
    reconnectTimersRef.current.clear()
  }, [])

  // ponytail：监听来自 ServerSettingsPanel 的 normal-reboot 事件
  useEffect(() => {
    const handler = (e: Event) => {
      const sid = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId
      if (sid) normalRebootSessionsRef.current.add(sid)
    }
    window.addEventListener('normal-reboot', handler)
    return () => window.removeEventListener('normal-reboot', handler)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  // LNMP 安装后断开 SSH 会话（环境发生变化，需要新建会话）

  const classifyError = (errorMsg: string): { type: 'auth' | 'network' | 'connection' | 'other'; message: string } => {
    const s = errorMsg.toLowerCase()
    
    // 身份验证错误
    if (s.includes('auth failed') || s.includes('auth error') || s.includes('authentication') || 
        s.includes('no authentication') || s.includes('permission denied') || s.includes('invalid password')) {
      return { type: 'auth', message: 'Authentication failed. Please check your username and password.' }
    }
    
    // 网络错误
    if (s.includes('timeout') || s.includes('timed out') || s.includes('network unreachable')) {
      return { type: 'network', message: 'Connection timed out. Please check network connectivity.' }
    }
    
    // 连接被拒绝
    if (s.includes('connection refused') || s.includes('host unreachable')) {
      return { type: 'connection', message: 'Connection refused. Server may be offline or port is incorrect.' }
    }
    
    // 密钥文件错误
    if (s.includes('key') && (s.includes('not found') || s.includes('invalid'))) {
      return { type: 'auth', message: 'SSH key file not found or invalid.' }
    }
    
    // 默认情况
    return { type: 'other', message: errorMsg }
  }

  const handleSelectConnection = (conn: SidebarConnection) => {
    handleDirectConnect(conn)
  }

  const handleDirectConnect = useCallback(async (conn: SidebarConnection, forceReconnect = false) => {
    const existing = sessionsRef.current.find(s => s.configId === conn.id)
    const isConnected = existing !== undefined && connectedConfigIds.has(conn.id)
    if (isConnected && !forceReconnect) {
      setActiveConfigId(conn.id)
      return
    }
    if (connectingIdsRef.current.has(conn.id)) {
      setActiveConfigId(conn.id)
      return
    }
    if (isConnected && existing?.sessionId) {
      replacingSessionsRef.current.add(existing.sessionId)
      await invoke('ssh_disconnect', { sessionId: existing.sessionId }).catch(() => {})
      markDisconnected(conn.id)
    }

    const doConnect = async (username: string, password?: string, keyPath?: string) => {
      connectingIdsRef.current.add(conn.id)
      setConnectingServerId(conn.id)
      setError('')
      const hostKey = `${conn.host}_${conn.port}`
      const panelKey = `lastPanel_${username}@${hostKey}`
      const estCols = Math.max(80, Math.floor((window.innerWidth - (sidebarVisible ? sidebarWidth + 10 : 40) - 20) / 8.4))
      const estRows = Math.max(24, Math.floor((window.innerHeight - 100) / 17))
      try {
        const savedPanelValue = await invoke<string>('ui_state_get', { key: panelKey }).catch(() => '')
        const savedPanel = (savedPanelValue || 'dashboard') as PanelSection
        const placeholder: ActiveSession = {
          configId: conn.id,
          sessionId: existing?.sessionId ?? null,
          name: conn.name || conn.host,
          hostKey,
          username,
          initialSection: existing?.initialSection ?? savedPanel,
        }
        setSessions(prev => {
          const next = prev.some(session => session.configId === conn.id)
            ? prev.map(session => session.configId === conn.id ? { ...session, name: placeholder.name, hostKey, username } : session)
            : [...prev, placeholder]
          sessionsRef.current = next
          return next
        })
        setSessionSections(prev => prev.has(conn.id) ? prev : new Map(prev).set(conn.id, placeholder.initialSection))
        setConnectionErrors(prev => { const next = new Map(prev); next.delete(conn.id); return next })
        setActiveConfigId(conn.id)
        let sid = ''
        let hostKeyUpdates = 0
        while (!sid) {
          try {
            sid = await invoke<string>('ssh_connect', {
              config: { host: conn.host, port: conn.port, username, password, keyPath, cols: estCols, rows: estRows },
            })
          } catch (error) {
            const verification = parseHostKeyVerification(error)
            if (!verification || hostKeyUpdates >= 2) throw error
            const fingerprint = `SHA256:${verification.fingerprint}`
            let approved = false
            if (verification.kind === 'unknown') {
              approved = window.confirm([
                `The authenticity of ${verification.host}:${verification.port} cannot be established.`,
                `Algorithm: ${verification.algorithm}`,
                `Fingerprint: ${fingerprint}`,
                '',
                'Verify this fingerprint through an independent channel before trusting it.',
                'Trust this host key and continue?',
              ].join('\n'))
            } else {
              const expected = verification.expectedFingerprint
                ? `SHA256:${verification.expectedFingerprint}`
                : 'unknown'
              const typed = window.prompt([
                `WARNING: The SSH host key for ${verification.host}:${verification.port} has changed.`,
                `Previously trusted: ${expected}`,
                `Presented now: ${fingerprint}`,
                '',
                'This can indicate a man-in-the-middle attack.',
                `After independently verifying the change, type ${fingerprint} to replace the trusted key.`,
              ].join('\n'))
              approved = typed?.trim() === fingerprint
              if (typed !== null && !approved) {
                window.alert('Fingerprint did not match. The trusted host key was not changed.')
              }
            }
            if (!approved) throw new Error('Host key verification was cancelled.')
            await invoke('ssh_trust_host_key', {
              host: verification.host,
              port: verification.port,
              keyBase64: verification.keyBase64,
              replace: verification.kind === 'changed',
            })
            hostKeyUpdates += 1
          }
        }
        if (!connectingIdsRef.current.has(conn.id) || !sessionsRef.current.some(session => session.configId === conn.id)) {
          await invoke('ssh_disconnect', { sessionId: sid }).catch(() => {})
          return
        }
        setSessions(prev => {
          const next = prev.map(session => session.configId === conn.id
            ? { ...session, sessionId: sid, name: conn.name || conn.host, hostKey, username }
            : session)
          sessionsRef.current = next
          return next
        })
        setConnectedConfigIds(prev => new Set(prev).add(conn.id))
        setActiveConfigId(conn.id)
        setConnectionErrors(prev => { const next = new Map(prev); next.delete(conn.id); return next })
        const WELCOME_INTERVAL = 6 * 60 * 60 * 1000
        const lastShown = Number(localStorage.getItem('welcome_last_shown') || 0)
        if (Date.now() - lastShown >= WELCOME_INTERVAL) {
          setShowWelcome(true)
          localStorage.setItem('welcome_last_shown', String(Date.now()))
          setTimeout(() => setShowWelcome(false), 4000)
        }
      } catch (e) {
        const msg = String(e)
        const { type, message } = classifyError(msg)
        if (connectingIdsRef.current.has(conn.id)) {
          setConnectionErrors(prev => new Map(prev).set(conn.id, { type, message }))
          setErrorDialog({ visible: true, message, type })
        }
      } finally {
        connectingIdsRef.current.delete(conn.id)
        setConnectingServerId(current => current === conn.id ? null : current)
      }
    }

    let password: string | undefined
    let keyPath: string | undefined
    
    if (conn.remember_me) {
      if (conn.auth_type === 'password' && !conn.password) {
        setErrorDialog({ visible: true, message: 'No password saved. Please edit the connection to add credentials.', type: 'auth' })
        return
      }
      if (conn.auth_type === 'password') password = conn.password
      if (conn.auth_type === 'key') keyPath = conn.key_path
    } else {
      setErrorDialog({ visible: true, message: 'Please edit the connection to configure authentication.', type: 'auth' })
      return
    }

    void doConnect(conn.username, password, keyPath)
  }, [connectedConfigIds, sidebarVisible, sidebarWidth])

  // 监听来自侧边栏的 reconnect-after-edit 事件（连接按钮）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.conn) void handleDirectConnect(detail.conn, true)
    }
    window.addEventListener('sidebar-reconnect-after-edit', handler)
    return () => window.removeEventListener('sidebar-reconnect-after-edit', handler)
  }, [handleDirectConnect])

  const requestNewSession = () => {
    setSidebarVisible(true)
    setNewConnectionRequestId(value => value + 1)
  }

  const requestEditConnection = (configId: string) => {
    setSidebarVisible(true)
    setEditConnectionRequest({ id: configId, requestId: Date.now() })
  }

  const cancelReconnect = (configId: string) => {
    reconnectGenerationRef.current.set(configId, (reconnectGenerationRef.current.get(configId) ?? 0) + 1)
    clearReconnectState(configId)
    markDisconnected(configId)
  }

  const reconnectSession = async (configId: string) => {
    cancelReconnect(configId)
    setConnectionErrors(prev => {
      if (!prev.has(configId)) return prev
      const next = new Map(prev)
      next.delete(configId)
      return next
    })
    try {
      const connections = await invoke<TerminalSavedConnection[]>('config_list')
      const connection = connections.find(item => item.id === configId)
      if (!connection) throw new Error(t('terminal.connection.configurationMissing'))
      handleDirectConnect(connection)
    } catch (reconnectError) {
      const message = String(reconnectError)
      setConnectionErrors(prev => new Map(prev).set(configId, { type: 'connection', message }))
      setErrorDialog({ visible: true, message, type: 'connection' })
    }
  }

  const closeOtherSessions = (configId: string) => {
    for (const session of [...sessionsRef.current]) {
      if (session.configId !== configId) closeSession(session.configId)
    }
  }

  const activateRelativeSession = (offset: number) => {
    const current = sessionsRef.current
    if (current.length < 2) return
    const index = current.findIndex(session => session.configId === activeConfigId)
    const nextIndex = (Math.max(index, 0) + offset + current.length) % current.length
    setActiveConfigId(current[nextIndex].configId)
  }

  const reorderSessions = (fromId: string, toId: string) => {
    const current = sessionsRef.current
    const fromIndex = current.findIndex(session => session.configId === fromId)
    const toIndex = current.findIndex(session => session.configId === toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const next = [...current]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    sessionsRef.current = next
    setSessions(next)
  }

  const updateSessionSection = (configId: string, section: PanelSection) => {
    setSessionSections(prev => {
      if (prev.get(configId) === section) return prev
      return new Map(prev).set(configId, section)
    })
  }

  const updateTerminalDimensions = (configId: string, dimensions: TerminalDimensions) => {
    setTerminalDimensions(prev => {
      const current = prev.get(configId)
      if (current?.cols === dimensions.cols && current.rows === dimensions.rows) return prev
      return new Map(prev).set(configId, dimensions)
    })
  }

  const markTerminalBackgroundOutput = (configId: string) => {
    if (configId === activeConfigId && activePanelSection === 'terminal') return
    setUnreadSessions(prev => prev.has(configId) ? prev : new Set(prev).add(configId))
  }

  const getConnectionState = (configId: string): TerminalConnectionState => {
    const reconnecting = reconnectingSessions.get(configId)
    if (reconnecting) return { kind: 'reconnecting', attempt: reconnecting.attempt, max: settings.max_reconnect_attempts }
    if (connectingIdsRef.current.has(configId) || connectingServerId === configId) return { kind: 'connecting' }
    if (connectedConfigIds.has(configId)) return { kind: 'connected' }
    const connectionError = connectionErrors.get(configId)
    if (connectionError?.type === 'auth') return { kind: 'authentication-failed', message: connectionError.message }
    return { kind: 'disconnected', reason: connectionError?.message }
  }

  const terminalTabs: TerminalSessionTabModel[] = sessions.map(session => {
    const endpoint = parseConnectionHost(session.hostKey)
    return {
      id: session.configId,
      name: session.name,
      username: session.username,
      host: endpoint.host,
      port: endpoint.port,
      state: getConnectionState(session.configId),
      dimensions: terminalDimensions.get(session.configId),
      hasUnread: unreadSessions.has(session.configId),
    }
  })

  const terminalTabStrip = sessions.length > 0 ? (
    <TerminalTabStrip
      sessions={terminalTabs}
      activeId={activeConfigId}
      commandAvailable={activePanelSection === 'terminal'}
      onActivate={setActiveConfigId}
      onClose={closeSession}
      onNewSession={requestNewSession}
      onConnect={handleDirectConnect}
      onOpenCommandPalette={() => activeTermRef.current?.openCommandPalette()}
      onReorder={reorderSessions}
    />
  ) : undefined

  const terminalOwnsConnectionStatus = activePanelSection === 'terminal' && activeSession !== null
  const showTopBar = Boolean(
    error ||
    pendingUpdate ||
    (!terminalOwnsConnectionStatus && (reconnectingSessions.has(activeConfigId || '') || toast || isDisconnected))
  )

  return (
    <div className="app">
      {sidebarVisible && (
        <>
          <div style={{ width: sidebarWidth, minWidth: sidebarWidth, flexShrink: 0, display: 'flex', position: 'relative' }}>
            <Sidebar
              onSelect={handleSelectConnection}
              onConnect={handleDirectConnect}
              onNew={() => {}}
              onCreateConnection={handleCreateConnection}
              refreshKey={sidebarRefreshKey}
              connectedIds={Array.from(connectedConfigIds)}
              connectingServerId={connectingServerId}
              activeConfigId={activeConfigId}
              newConnectionRequestId={newConnectionRequestId}
              editConnectionRequest={editConnectionRequest}
              onNewConnectionRequestHandled={requestId => setNewConnectionRequestId(current => current === requestId ? 0 : current)}
              onEditConnectionRequestHandled={requestId => setEditConnectionRequest(current => current?.requestId === requestId ? null : current)}
            />
            {/* 侧边栏切换按钮 */}
            <button 
              className="sidebar-toggle-btn visible"
              onClick={() => setSidebarVisible(false)}
              title={t('common.hidePanel')}
            >
              HIDE
            </button>
          </div>
          <div
            className="v-divider"
            onMouseDown={() => startDrag('sidebar')}
          />
        </>
      )}
      {!sidebarVisible && (
        <button 
          className="sidebar-toggle-btn hidden"
          onClick={() => setSidebarVisible(true)}
          title={t('common.showPanel')}
        >
          SHOW
        </button>
      )}
      <div className="main-area">
        {showTopBar && <div className="top-bar">
          {error && <div className="error-bar">{error}</div>}
          {!terminalOwnsConnectionStatus && activeConfigId && reconnectingSessions.has(activeConfigId) && (() => {
            const info = reconnectingSessions.get(activeConfigId)!
            return (
              <div className="toast-bar">
                <span>↻ [{info.name}] {t('common.reconnectAttempt', { attempt: info.attempt, max: settings.max_reconnect_attempts })}</span>
                <button className="toast-stop-btn" onClick={() => cancelReconnect(activeConfigId)}>{t('common.stop')}</button>
              </div>
            )
          })()}
          {!terminalOwnsConnectionStatus && toast && !reconnectingSessions.has(activeConfigId || '') && !isDisconnected && (
            <div className="toast-bar">
              <span>{toast}</span>
            </div>
          )}
          {!terminalOwnsConnectionStatus && isDisconnected && (
            <div className="toast-bar disconnected-bar">{t('common.disconnectedBanner')}</div>
          )}
          {pendingUpdate && (
            <div className="update-ready-bar">
              <span>Update v{pendingUpdate.version} ready</span>
              <button className="update-restart-btn" onClick={async () => { await pendingUpdate.install() }}>Restart Now</button>
            </div>
          )}
        </div>}
        
        {/* 错误对话框 */}
        {errorDialog?.visible && (
          <div className="error-dialog-overlay" onClick={() => setErrorDialog(null)}>
            <div className="error-dialog" onClick={(e) => e.stopPropagation()}>
              <button className="error-dialog-close" onClick={() => setErrorDialog(null)}>×</button>
              <div className="error-dialog-title">{t('errorDialog.connectionFailed')}</div>
              <div className="error-dialog-message">{errorDialog.message}</div>
              <button className="error-dialog-btn" onClick={() => setErrorDialog(null)}>{t('common.close')}</button>
            </div>
          </div>
        )}
        <div className="split-container" ref={splitContainerRef}>
          <div className="split-full">
            {sessions.map(s => (
              <div key={s.configId} className={`server-session ${s.configId === activeConfigId ? 'active' : ''}`}>
                <ServerPanel
                  sessionId={s.sessionId}
                  connHost={s.hostKey}
                  connUsername={s.username}
                  initialSection={s.initialSection}
                  jumpToPath={s.configId === activeConfigId ? jumpToPath : null}
                  setJumpToPath={setJumpToPath}
                  termRef={{
                    get current() { return termRefMap.current.get(s.configId) ?? null },
                    set current(h: TerminalHandle | null) { termRefMap.current.set(s.configId, h); if (s.configId === activeConfigId) activeTermRef.current = h }
                  }}
                  onStartUpload={handleStartUpload}
                  onUploadComplete={uploadCompleteRef}
                  appSettings={settings}
                  onToggleAutoReconnect={toggleAutoReconnect}
                  onUpdateSettings={handleUpdateSettings}
                  onShowToast={showToast}
                  isSessionActive={s.configId === activeConfigId}
                  terminalTabStrip={s.configId === activeConfigId ? terminalTabStrip : undefined}
                  connectionState={getConnectionState(s.configId)}
                  onReconnect={() => void reconnectSession(s.configId)}
                  onCancelReconnect={() => cancelReconnect(s.configId)}
                  onCloseSession={() => closeSession(s.configId)}
                  onNewSession={requestNewSession}
                  onCloseOtherSessions={() => closeOtherSessions(s.configId)}
                  onNextSession={() => activateRelativeSession(1)}
                  onPreviousSession={() => activateRelativeSession(-1)}
                  onEditConnection={() => requestEditConnection(s.configId)}
                  onSectionChange={section => updateSessionSection(s.configId, section)}
                  onTerminalDimensionsChange={dimensions => updateTerminalDimensions(s.configId, dimensions)}
                  onTerminalBackgroundOutput={() => markTerminalBackgroundOutput(s.configId)}
                />
              </div>
            ))}
            {/* ponytail：没有会话时仍显示导航，仪表盘和讨论区可点击，其他项禁用 */}
            {sessions.length === 0 && <ServerPanel sessionId={null} onShowToast={showToast} />}
          </div>
        </div>
      </div>


      {/* 浮动上传面板 */}
      {upload.queue.length > 0 && (
        <UploadPanel
          upload={upload}
          onPause={handlePauseUpload}
          onResume={handleResumeUpload}
          onStop={handleStopUpload}
          onDismiss={handleDismissUpload}
                    onRetry={handleRetryFailed}
        />
      )}

      {/* 欢迎弹窗 */}
      {showWelcome && (
        <div className="welcome-overlay">
          <div className="welcome-modal">
            <button className="welcome-close-btn" onClick={() => setShowWelcome(false)} title={t('common.close')}>×</button>
            <div className="welcome-icon"></div>
            <h2 className="welcome-title">{t('welcome.title')}</h2>
            <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
            <div className="welcome-features">
              <span>{t('welcome.secureConnections')}</span>
              <span>{t('welcome.fileManagement')}</span>
              <span>{t('welcome.serverControl')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



function UploadPanel({ upload, onPause, onResume, onStop, onDismiss, onRetry }: {
  upload: UploadState
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onDismiss: () => void
    onRetry: () => void
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [stopInput, setStopInput] = useState('')
  const stopInputRef = useRef<HTMLInputElement>(null)
  const stopConfirmed = stopInput.trim().toLowerCase() === 'stop'
  const pct = upload.totalBytes > 0 ? Math.round((upload.uploadedBytes / upload.totalBytes) * 100) : 0
  const uploadedMB = (upload.uploadedBytes / 1048576).toFixed(1)
  const totalMB = (upload.totalBytes / 1048576).toFixed(1)
  const remainingMB = ((upload.totalBytes - upload.uploadedBytes) / 1048576).toFixed(1)
  const speedStr = upload.speed >= 1048576
    ? `${(upload.speed / 1048576).toFixed(1)} MB/s`
    : `${(upload.speed / 1024).toFixed(0)} KB/s`
  const doneCount = upload.queue.filter(q => q.status === 'done').length
  const allDone = !upload.active && upload.queue.every(q => q.status === 'done' || q.status === 'error' || q.status === 'stopped')
    const failedCount = upload.queue.filter(q => q.status === 'error').length

  return (
    <div className={`upload-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="upload-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="upload-panel-title">
          {upload.active ? (upload.paused ? t('upload.paused') : t('upload.uploading')) : allDone ? t('upload.complete') : t('upload.stopped')}
          {' '}{doneCount}/{upload.queue.length}
          {upload.active && !upload.paused && ` — ${pct}% — ${upload.workers}`}
        </span>
        <span className="upload-panel-toggle">{collapsed ? '^' : 'v'}</span>
      </div>
      {!collapsed && (
        <>
          {upload.active && (
            <div className="upload-panel-progress">
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="upload-progress-info">
                {uploadedMB}M / {totalMB}M | {t('upload.remaining')} {remainingMB}M | {speedStr}
              </div>
            </div>
          )}
          <div className="upload-panel-queue">
            {upload.queue.map((item, i) => (
              <div key={i} className={`upload-queue-item ${item.status}`}>
                <span className="upload-item-name" title={item.fileName}>{item.fileName}</span>
                <span className="upload-item-size">{(item.file.size / 1048576).toFixed(1)}M</span>
                {item.retryCount && item.retryCount > 0 && item.status === 'pending' && <span className="upload-item-retry">{item.retryCount}/3</span>}
                {item.error && <span className="upload-item-error" title={item.error}>!</span>}
              </div>
            ))}
          </div>
          <div className="upload-panel-actions">
            {upload.active && !upload.paused && (
              <>
                <button className="upload-btn" onClick={onPause} title={t('upload.pause')}>{t('upload.pause')}</button>
                <button className="upload-btn" onClick={() => { setShowStopConfirm(true); setStopInput('') }} title={t('upload.stop')}>{t('upload.stop')}</button>
              </>
            )}
            {upload.active && upload.paused && (
              <>
                <button className="upload-btn" onClick={onResume} title={t('upload.resume')}>{t('upload.resume')}</button>
                <button className="upload-btn" onClick={() => { setShowStopConfirm(true); setStopInput('') }} title={t('upload.stop')}>{t('upload.stop')}</button>
              </>
            )}
            {!upload.active && (
              <>
                {failedCount > 0 && (
                  <button className="upload-btn" onClick={onRetry} title={t('upload.retryFailed')}>{t('upload.retryFailed')} ({failedCount})</button>
                )}
                <button className="upload-btn" onClick={onDismiss} title={t('common.close')}>{t('common.close')}</button>
              </>
            )}
          </div>
        </>
      )}

      {/* 停止确认弹窗 */}
      {showStopConfirm && (
        <div className="fb-dialog-overlay" onClick={() => setShowStopConfirm(false)}>
          <div className="fb-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 380 }}>
            <button className="modal-close-btn" onClick={() => setShowStopConfirm(false)} title={t('common.close')}>×</button>
            <div className="fb-dialog-title" style={{ marginBottom: 12 }}>{t('upload.confirmStopTitle')}</div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {t('upload.confirmStopMsg')}
            </p>
            <input
              ref={stopInputRef}
              className="fb-dialog-input"
              value={stopInput}
              onChange={e => setStopInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && stopConfirmed) { onStop(); setShowStopConfirm(false) } }}
              placeholder={t('upload.confirmStopPlaceholder')}
              autoFocus
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
            <div className="fb-dialog-actions">
              <button className="fb-dialog-btn" onClick={() => setShowStopConfirm(false)}>{t('common.cancel')}</button>
              <button className="fb-dialog-btn danger" disabled={!stopConfirmed} onClick={() => { onStop(); setShowStopConfirm(false) }} style={{ opacity: stopConfirmed ? 1 : 0.4 }}>
                {t('upload.stop')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
