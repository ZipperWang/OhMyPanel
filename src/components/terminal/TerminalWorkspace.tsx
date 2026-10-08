import type { ReactNode } from 'react'

interface TerminalWorkspaceProps {
  terminalMode: boolean
  tabStrip?: ReactNode
  children: ReactNode
}

export default function TerminalWorkspace({ terminalMode, tabStrip, children }: TerminalWorkspaceProps) {
  return (
    <div className={`terminal-workspace ${terminalMode ? 'terminal-mode' : ''}`}>
      {tabStrip}
      {children}
    </div>
  )
}
