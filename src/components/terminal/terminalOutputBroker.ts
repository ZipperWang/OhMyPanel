import { listen } from '@tauri-apps/api/event'

interface TerminalOutputPayload {
  sessionId: string
  data: string
}

interface BufferedOutput {
  chunks: string[]
  size: number
  timer: ReturnType<typeof setTimeout>
}

type OutputSubscriber = (data: string) => void

const MAX_BUFFER_SIZE = 512 * 1024
const BUFFER_TTL = 30_000
const subscribers = new Map<string, Set<OutputSubscriber>>()
const bufferedOutput = new Map<string, BufferedOutput>()
let brokerReady: Promise<void> | null = null

function storeOutput(sessionId: string, data: string): void {
  const existing = bufferedOutput.get(sessionId)
  if (existing) clearTimeout(existing.timer)
  const chunks = existing?.chunks ?? []
  let size = (existing?.size ?? 0) + data.length
  chunks.push(data)
  while (size > MAX_BUFFER_SIZE && chunks.length > 1) {
    size -= chunks.shift()?.length ?? 0
  }
  const timer = setTimeout(() => bufferedOutput.delete(sessionId), BUFFER_TTL)
  bufferedOutput.set(sessionId, { chunks, size, timer })
}

function dispatchOutput({ sessionId, data }: TerminalOutputPayload): void {
  const current = subscribers.get(sessionId)
  if (!current?.size) {
    storeOutput(sessionId, data)
    return
  }
  for (const subscriber of current) subscriber(data)
}

export function ensureTerminalOutputBroker(): Promise<void> {
  if (!brokerReady) {
    brokerReady = listen<TerminalOutputPayload>('ssh-output', event => dispatchOutput(event.payload))
      .then(() => undefined)
      .catch(error => {
        brokerReady = null
        throw error
      })
  }
  return brokerReady
}

export function subscribeTerminalOutput(sessionId: string, subscriber: OutputSubscriber): () => void {
  let active = true
  void ensureTerminalOutputBroker().then(() => {
    if (!active) return
    const current = subscribers.get(sessionId) ?? new Set<OutputSubscriber>()
    current.add(subscriber)
    subscribers.set(sessionId, current)
    const buffered = bufferedOutput.get(sessionId)
    if (!buffered) return
    clearTimeout(buffered.timer)
    bufferedOutput.delete(sessionId)
    subscriber(buffered.chunks.join(''))
  }).catch(() => {})
  return () => {
    active = false
    const current = subscribers.get(sessionId)
    current?.delete(subscriber)
    if (current?.size === 0) subscribers.delete(sessionId)
  }
}

export function clearTerminalOutput(sessionId: string): void {
  const buffered = bufferedOutput.get(sessionId)
  if (buffered) clearTimeout(buffered.timer)
  bufferedOutput.delete(sessionId)
}
