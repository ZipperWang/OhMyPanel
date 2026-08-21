export type TerminalConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number; max: number }
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'authentication-failed'; message?: string }

export interface TerminalDimensions {
  cols: number
  rows: number
}

export interface TerminalSessionTabModel {
  id: string
  name: string
  username: string
  host: string
  port: number
  state: TerminalConnectionState
  dimensions?: TerminalDimensions
  hasUnread?: boolean
}

export interface TerminalSavedConnection {
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
