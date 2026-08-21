import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import '@xterm/xterm/css/xterm.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface TerminalProps {
  sessionId: string | null
  isActive?: boolean
  theme?: string
}

export interface TerminalHandle {
  sendCommand: (cmd: string) => void
  clear: () => void
}

// GitHub 深色配色
const XTERM_DARK_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  selectionBackground: '#264f78',
  black: '#0d1117',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#c9d1d9',
  brightBlack: '#484f58',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
}

// GitHub 浅色配色（theme = light 时使用）
const XTERM_LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0969da',
  selectionBackground: '#c8daf5',
  black: '#1f2328',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#6e7781',
  brightRed: '#cf222e',
  brightGreen: '#1a7f37',
  brightYellow: '#9a6700',
  brightBlue: '#0969da',
  brightMagenta: '#8250df',
  brightCyan: '#1b7c83',
  brightWhite: '#ffffff',
}

export default forwardRef<TerminalHandle, TerminalProps>(function Terminal({ sessionId, isActive, theme = 'light' }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sidRef = useRef(sessionId)
  // ponytail：自行跟踪选中状态，因为 ClipboardAddon 可能在 onData 触发前清除该状态
  const hasSelectionRef = useRef(false)

  useEffect(() => {
    sidRef.current = sessionId
  }, [sessionId])

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Menlo', 'Monaco', 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace",
      allowProposedApi: true,
      theme: theme === 'light' ? XTERM_LIGHT_THEME : XTERM_DARK_THEME,
      allowTransparency: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    // ponytail：屏蔽所有 DECSET/DECRST 鼠标跟踪序列，使本地文本选择正常工作
    // 远程 Shell（bash/tmux/vim）会发送 \e[?1000h 等序列来捕获鼠标事件
    const MOUSE_MODES = new Set([9, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1015])
    for (const final of ['h', 'l']) {
      term.parser.registerCsiHandler({ final, prefix: '?' }, (params) => {
        const p = Array.isArray(params[0]) ? params[0][0] : params[0]
        if (MOUSE_MODES.has(p)) return true // 屏蔽鼠标跟踪
        return false
      })
    }

    const clipboardAddon = new ClipboardAddon()
    term.loadAddon(clipboardAddon)

    // 跟踪选中状态，用于 Ctrl+C 复制逻辑
    term.onSelectionChange(() => {
      hasSelectionRef.current = term.hasSelection()
    })

    // ponytail：每次 fit 后将远程 PTY 大小与 xterm.js 同步
    const syncSize = () => {
      const sid = sidRef.current
      if (sid) {
        invoke('ssh_resize', { sessionId: sid, cols: term.cols, rows: term.rows })
      }
    }
    setTimeout(() => { fitAddon.fit(); syncSize() }, 100)

    term.onData((data) => {
      const sid = sidRef.current
      if (sid) {
        // ponytail：选中文本时，Ctrl+C 只执行复制（不发送中断信号）
        // 使用自有 ref，因为 ClipboardAddon 可能已清除 term.hasSelection()
        if (data === '\x03' && hasSelectionRef.current) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {})
          term.clearSelection()
          hasSelectionRef.current = false
          return
        }
        invoke('ssh_input', { sessionId: sid, data })
      }
    })

    termRef.current = term
    fitRef.current = fitAddon

    // 通过 ref 暴露 sendCommand
    // (done in separate useEffect below)

    // 监听 SSH 输出
    const unlisten = listen<{ sessionId: string; data: string }>('ssh-output', (event) => {
      const sid = sidRef.current
      if (sid && event.payload.sessionId === sid) {
        term.write(event.payload.data)
      }
    })

    // 处理大小调整
    const handleResize = () => {
      if (fitRef.current) {
        fitRef.current.fit()
        const sid = sidRef.current
        if (sid) {
          invoke('ssh_resize', {
            sessionId: sid,
            cols: term.cols,
            rows: term.rows,
          })
        }
      }
    }
    window.addEventListener('resize', handleResize)

    // 监听连接关闭
    const unlistenClosed = listen<string>('ssh-closed', (event) => {
      const sid = sidRef.current
      if (sid && event.payload === sid) {
        term.clear()
      }
    })

    return () => {
      unlisten.then((fn) => fn())
      unlistenClosed.then((fn) => fn())
      window.removeEventListener('resize', handleResize)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    sendCommand: (cmd: string) => {
      const sid = sidRef.current
      if (sid && termRef.current) {
        invoke('ssh_input', { sessionId: sid, data: cmd + '\r' })
      }
    },
    clear: () => {
      termRef.current?.clear()
    },
  }))

  // ponytail：应用主题变化时实时切换 xterm 配色
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme === 'light' ? XTERM_LIGHT_THEME : XTERM_DARK_THEME
    }
  }, [theme])

  // 会话变化时重新适配并同步 PTY
  useEffect(() => {
    if (fitRef.current && termRef.current) {
      setTimeout(() => {
        fitRef.current?.fit()
        if (sessionId) {
          invoke('ssh_resize', { sessionId, cols: termRef.current!.cols, rows: termRef.current!.rows })
        }
      }, 100)
    }
  }, [sessionId])

  // 标签页变为活动状态时重新适配（之前通过 display:none 隐藏）并同步 PTY
  useEffect(() => {
    if (isActive && fitRef.current && termRef.current) {
      setTimeout(() => {
        fitRef.current?.fit()
        const sid = sidRef.current
        if (sid) {
          invoke('ssh_resize', { sessionId: sid, cols: termRef.current!.cols, rows: termRef.current!.rows })
        }
      }, 50)
    }
  }, [isActive])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: 'var(--bg)' }}
    />
  )
})
