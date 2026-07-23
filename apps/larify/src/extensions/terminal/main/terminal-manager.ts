import { addListener, type Listener } from '../../../main/utils/listener'
import { createKeyedLock } from '../../../main/utils/lock'
import { Terminal, type SavableFront, type ShellCommandFinishedEvent } from './terminal'
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

const RUN_TAIL_LIMIT = 1000

interface ActiveRun {
  log: TerminalRunLog
  finalized: boolean
}

export class TerminalManager {
  private terminals = new Map<number, Terminal>()
  private activeRuns = new Map<number, ActiveRun>()
  private flushLock = createKeyedLock()
  private flushQueued = new Set<number>()
  private writerLock = createKeyedLock()
  private activeId: number | null = null
  private nextId = 1
  private changeListeners = new Set<Listener<[SessionTerminalsState]>>()
  private dataListeners = new Set<Listener<[number, string, number, number]>>()
  private exitListeners = new Set<Listener<[number, number]>>()
  private commandFinishedListeners = new Set<Listener<[number, ShellCommandFinishedEvent]>>()
  private commandStartedListeners = new Set<Listener<[number]>>()

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

  bindCommandStarted(callback: (terminalId: number) => void): () => void {
    return addListener(this.commandStartedListeners, callback)
  }

  create(opts?: TerminalCreateOptions): number {
    const terminal = new Terminal(this.nextId++, opts)
    terminal.bindData((data, start, end) => {
      this.queueFlush(terminal.id)
      for (const listener of this.dataListeners) listener(terminal.id, data, start, end)
    })
    terminal.bindExit((exitCode) => {
      for (const listener of this.exitListeners) listener(terminal.id, exitCode)
      void this.writerLock(String(terminal.id), async () => {
        await this.finalizeRun(terminal.id)
        this.forget(terminal.id)
        this.emit()
      })
        .catch(() => {})
        .finally(() => terminal.dispose())
    })
    terminal.bindCommandFinished((event) => {
      void this.drainRun(terminal.id, false).catch(() => {})
      for (const listener of this.commandFinishedListeners) listener(terminal.id, event)
    })
    terminal.bindCommandStarted(() => {
      for (const listener of this.commandStartedListeners) listener(terminal.id)
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
    return this.writerLock(String(id), async () => {
      if (!this.terminals.has(id)) throw new Error(`Terminal "${id}" not found.`)
      return fn()
    })
  }

  async startRun(id: number): Promise<TerminalRunLog | null> {
    const terminal = this.terminals.get(id)
    if (!terminal) return null
    await this.finalizeRun(id)
    await terminal.beginRun()
    const log = createTerminalRunLog(this.sessionId)
    this.activeRuns.set(id, { log, finalized: false })
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
    if (this.activeRuns.has(id)) {
      const tail = await terminal.readRunTail(RUN_TAIL_LIMIT)
      if (tail.length > 0) return { screen: tail.join('\n') }
    }
    return terminal.agentSnapshot()
  }

  async flushRunHistory(id: number): Promise<TerminalRunLog | null> {
    return this.flushLock(String(id), () => this.performFlushRunHistory(id))
  }

  private queueFlush(id: number): void {
    if (this.flushQueued.has(id)) return
    this.flushQueued.add(id)
    void this.flushLock(String(id), () => {
      this.flushQueued.delete(id)
      return this.performFlushRunHistory(id)
    }).catch(() => this.flushQueued.delete(id))
  }

  private async persist(log: TerminalRunLog, front: SavableFront | null): Promise<void> {
    if (!front) return
    try {
      await appendRunLog(log, front.lines.join('\n'))
      front.commit()
    } catch (error) {
      front.discard()
      console.error('[terminal:run-log]', error)
    }
  }

  private async performFlushRunHistory(id: number): Promise<TerminalRunLog | null> {
    const terminal = this.terminals.get(id)
    const run = this.activeRuns.get(id)
    if (!terminal || !run || run.finalized) return run?.log ?? null

    await this.persist(run.log, await terminal.takeSavableFront(RUN_TAIL_LIMIT))
    return run.log
  }

  private async drainRun(id: number, endOfRun: boolean): Promise<void> {
    await this.flushLock(String(id), async () => {
      const terminal = this.terminals.get(id)
      const run = this.activeRuns.get(id)
      if (!terminal || !run || run.finalized) return
      await this.persist(run.log, await terminal.takeSavableFront(RUN_TAIL_LIMIT))
      if (run.log.path) await this.persist(run.log, await terminal.takeAllRemaining())
      run.finalized = endOfRun
    })
  }

  private finalizeRun(id: number): Promise<void> {
    return this.drainRun(id, true)
  }

  terminalState(id: number): ReturnType<Terminal['state']> | null {
    return this.terminals.get(id)?.state() ?? null
  }

  private forget(id: number): void {
    const index = [...this.terminals.keys()].indexOf(id)
    if (index < 0) return
    this.terminals.delete(id)
    this.activeRuns.delete(id)
    this.flushQueued.delete(id)
    if (this.activeId === id) {
      const remaining = [...this.terminals.keys()]
      this.activeId = remaining[index] ?? remaining[index - 1] ?? null
    }
  }

  async close(id: number): Promise<void> {
    await this.withWriterLock(id, async () => {
      const terminal = this.terminals.get(id)
      if (!terminal) return

      await this.finalizeRun(id)
      terminal.close()
      terminal.dispose()
      this.forget(id)
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
    await Promise.all([...this.terminals.keys()].map((id) => this.finalizeRun(id)))
    for (const terminal of this.terminals.values()) {
      terminal.kill()
      terminal.dispose()
    }
    this.terminals.clear()
    this.activeRuns.clear()
    this.activeId = null
    this.emit()
  }

  private emit(): void {
    const state = this.state()
    for (const listener of this.changeListeners) listener(state)
  }

}
