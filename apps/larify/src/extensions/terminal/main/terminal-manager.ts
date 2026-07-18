import { addListener, type Listener } from '../../../main/utils/listener'
import { Terminal, type ShellCommandFinishedEvent } from './terminal'
import {
  appendRunLog,
  createTerminalRunLog,
  type TerminalRunLog
} from './terminal-run-log'
import type {
  SessionTerminalsState,
  TerminalAgentSnapshot,
  TerminalCreateOptions,
  TerminalSnapshot
} from '../shared/types'

const HISTORY_SAFETY_MARGIN = 2000

interface ActiveRun {
  log: TerminalRunLog
  flushedUntilRow: number
}

export class TerminalManager {
  private terminals = new Map<number, Terminal>()
  private activeRuns = new Map<number, ActiveRun>()
  private flushing = new Set<number>()
  private writerQueues = new Map<number, Promise<unknown>>()
  private activeId: number | null = null
  private nextId = 1
  private changeListeners = new Set<Listener<[SessionTerminalsState]>>()
  private dataListeners = new Set<Listener<[number, string, number, number]>>()
  private exitListeners = new Set<Listener<[number, number]>>()
  private commandFinishedListeners = new Set<Listener<[number, ShellCommandFinishedEvent]>>()

  constructor(private readonly sessionId: string) {}

  bindChange(callback: (state: SessionTerminalsState) => void): () => void {
    return addListener(this.changeListeners, callback)
  }

  bindData(callback: (terminalId: number, data: string, start: number, end: number) => void): () => void {
    return addListener(this.dataListeners, callback)
  }

  bindExit(callback: (terminalId: number, exitCode: number) => void): () => void {
    return addListener(this.exitListeners, callback)
  }

  bindCommandFinished(
    callback: (terminalId: number, event: ShellCommandFinishedEvent) => void
  ): () => void {
    return addListener(this.commandFinishedListeners, callback)
  }

  create(opts?: TerminalCreateOptions): number {
    const terminal = new Terminal(this.nextId++, opts)
    terminal.bindData((data, start, end) => {
      void this.flushRunHistory(terminal.id)
      for (const listener of this.dataListeners) listener(terminal.id, data, start, end)
    })
    terminal.bindExit((exitCode) => {
      for (const listener of this.exitListeners) listener(terminal.id, exitCode)
      this.emit()
    })
    terminal.bindCommandFinished((event) => {
      for (const listener of this.commandFinishedListeners) listener(terminal.id, event)
    })
    this.terminals.set(terminal.id, terminal)
    this.activeId = terminal.id
    this.emit()
    return terminal.id
  }

  write(id: number, data: string): void {
    this.terminals.get(id)?.write(data)
  }

  async withWriterLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
    if (!this.terminals.has(id)) throw new Error(`Terminal "${id}" not found.`)
    const previous = this.writerQueues.get(id) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current, () => current)
    this.writerQueues.set(id, queued)
    await previous.catch(() => {})
    if (!this.terminals.has(id)) throw new Error(`Terminal "${id}" not found.`)
    try {
      return await fn()
    } finally {
      release()
      if (this.writerQueues.get(id) === queued) this.writerQueues.delete(id)
    }
  }

  async startRun(id: number): Promise<TerminalRunLog | null> {
    const terminal = this.terminals.get(id)
    if (!terminal) return null
    await this.flushRunHistory(id)
    const currentRenderedRow = await terminal.currentRenderedRow()
    const log = createTerminalRunLog(this.sessionId)
    this.activeRuns.set(id, {
      log,
      flushedUntilRow: currentRenderedRow - 1
    })
    return log
  }

  resize(id: number, cols: number, rows: number): void {
    this.terminals.get(id)?.resize(cols, rows)
  }

  setActive(id: number): void {
    if (!this.terminals.has(id) || this.activeId === id) return
    this.activeId = id
    this.emit()
  }

  reorder(id: number, toIndex: number): void {
    const terminal = this.terminals.get(id)
    if (!terminal) return

    const ordered = [...this.terminals.entries()].filter(([terminalId]) => terminalId !== id)
    const nextIndex = Math.max(0, Math.min(toIndex, ordered.length))
    ordered.splice(nextIndex, 0, [id, terminal])
    this.terminals = new Map(ordered)
    this.emit()
  }

  snapshot(id: number): Promise<TerminalSnapshot | null> {
    return this.terminals.get(id)?.snapshot() ?? Promise.resolve(null)
  }

  async agentSnapshot(id: number): Promise<TerminalAgentSnapshot | null> {
    const terminal = this.terminals.get(id)
    if (!terminal) return null
    await this.flushRunHistory(id)
    return terminal.agentSnapshot()
  }

  async flushRunHistory(id: number): Promise<TerminalRunLog | null> {
    if (this.flushing.has(id)) return this.activeRuns.get(id)?.log ?? null

    this.flushing.add(id)
    try {
      return await this.performFlushRunHistory(id)
    } finally {
      this.flushing.delete(id)
    }
  }

  private async performFlushRunHistory(id: number): Promise<TerminalRunLog | null> {
    const terminal = this.terminals.get(id)
    const run = this.activeRuns.get(id)
    if (!terminal || !run) return null

    const flushed = await terminal.flushRenderedRowsBeforeTail(
      run.flushedUntilRow,
      HISTORY_SAFETY_MARGIN
    )
    if (flushed) {
      await appendRunLog(run.log, flushed.text)
      run.flushedUntilRow = flushed.flushedUntilRow
    }
    return run.log
  }

  terminalState(id: number): ReturnType<Terminal['state']> | null {
    return this.terminals.get(id)?.state() ?? null
  }

  async close(id: number): Promise<void> {
    await this.withWriterLock(id, async () => {
      const terminal = this.terminals.get(id)
      if (!terminal) return

      const order = [...this.terminals.keys()]
      const index = order.indexOf(id)
      await this.flushRunHistory(id)
      terminal.close()
      this.terminals.delete(id)
      this.activeRuns.delete(id)
      this.writerQueues.delete(id)
      if (this.activeId === id) {
        const remaining = [...this.terminals.keys()]
        this.activeId = remaining[index] ?? remaining[index - 1] ?? null
      }
      this.emit()
    })
  }

  state(): SessionTerminalsState {
    return {
      sessionId: this.sessionId,
      terminals: [...this.terminals.values()].map((terminal) => terminal.state()),
      activeId: this.activeId
    }
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.terminals.keys()].map((id) => this.flushRunHistory(id)))
    for (const terminal of this.terminals.values()) terminal.kill()
    this.terminals.clear()
    this.activeRuns.clear()
    this.writerQueues.clear()
    this.activeId = null
    this.emit()
  }

  private emit(): void {
    const state = this.state()
    for (const listener of this.changeListeners) listener(state)
  }

}
