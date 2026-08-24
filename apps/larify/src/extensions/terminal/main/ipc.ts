import { ipcMain, type BrowserWindow } from 'electron'
import type { TerminalService } from './terminal-service'
import type { TerminalSnapshot } from '../shared/types'

const BATCH_MS = 10

class DataBatcher {
  private chunks: Array<{ data: string; start: number; end: number }> = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly send: (event: { data: string; start: number; end: number }) => void
  ) {}

  push(data: string, start: number, end: number): void {
    this.chunks.push({ data, start, end })
    if (!this.timer) this.timer = setTimeout(() => this.flush(), BATCH_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.chunks.length === 0) return
    const start = this.chunks[0].start
    const end = this.chunks[this.chunks.length - 1].end
    const data = this.chunks.map((chunk) => chunk.data).join('')
    this.chunks = []
    this.send({ data, start, end })
  }
}

const batchKey = (sessionId: string, terminalId: number): string => `${sessionId}:${terminalId}`

export function registerTerminalIpc(service: TerminalService, window: BrowserWindow): () => void {
  const batchers = new Map<string, DataBatcher>()

  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }

  const batcher = (sessionId: string, terminalId: number): DataBatcher => {
    const key = batchKey(sessionId, terminalId)
    let batcher = batchers.get(key)
    if (!batcher) {
      batcher = new DataBatcher((event) =>
        send('terminal:data', { sessionId, terminalId, ...event })
      )
      batchers.set(key, batcher)
    }
    return batcher
  }

  const unbindChange = service.bindChange((state) => {
    const alive = new Set(state.terminals.map(({ id }) => batchKey(state.sessionId, id)))
    const prefix = `${state.sessionId}:`
    for (const [key, pending] of batchers) {
      if (!key.startsWith(prefix) || alive.has(key)) continue
      pending.flush()
      batchers.delete(key)
    }
    send('terminal:state', state)
  })
  const unbindData = service.bindData((sessionId, terminalId, data, start, end) =>
    batcher(sessionId, terminalId).push(data, start, end)
  )
  const unbindExit = service.bindExit((sessionId, terminalId, exitCode) => {
    const key = batchKey(sessionId, terminalId)
    batchers.get(key)?.flush()
    batchers.delete(key)
    send('terminal:exit', { sessionId, terminalId, exitCode })
  })
  const unbindCommandFinished = service.bindCommandFinished((sessionId, terminalId, event) => {
    const cwd = service.terminalState(sessionId, terminalId)?.cwd
    if (cwd) send('terminal:command-finished', { sessionId, terminalId, cwd, ...event })
  })

  ipcMain.handle('terminal:getState', (_event, sessionId: string) => service.state(sessionId))
  ipcMain.handle('terminal:write', (_event, sessionId: string, terminalId: number, data: string) =>
    service.write(sessionId, terminalId, data)
  )
  ipcMain.handle(
    'terminal:resize',
    (_event, sessionId: string, terminalId: number, cols: number, rows: number) =>
      service.resize(sessionId, terminalId, cols, rows)
  )
  ipcMain.handle(
    'terminal:snapshot',
    (_event, sessionId: string, terminalId: number): Promise<TerminalSnapshot | null> => {
      batchers.get(batchKey(sessionId, terminalId))?.flush()
      return service.snapshot(sessionId, terminalId)
    }
  )

  const channels = ['terminal:getState', 'terminal:write', 'terminal:resize', 'terminal:snapshot']

  return () => {
    unbindChange()
    unbindData()
    unbindExit()
    unbindCommandFinished()
    for (const channel of channels) ipcMain.removeHandler(channel)
    for (const batcher of batchers.values()) batcher.flush()
    batchers.clear()
  }
}
