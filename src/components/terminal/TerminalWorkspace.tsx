import { useEffect, useRef, type ReactNode } from 'react'

interface TerminalWorkspaceProps {
  terminalMode: boolean
  tabStrip?: ReactNode
  children: ReactNode
}

export default function TerminalWorkspace({ terminalMode, tabStrip, children }: TerminalWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!terminalMode && document.fullscreenElement === workspaceRef.current) {
      void document.exitFullscreen().catch(() => {})
    }
  }, [terminalMode])

  return (
    <div ref={workspaceRef} className={`terminal-workspace ${terminalMode ? 'terminal-mode' : ''}`}>
      {tabStrip}
      {children}
    </div>
  )
}
