import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { spawn, type IPty } from 'node-pty'
import { addListener, type Listener } from '../../../main/utils/listener'
import {
  readAgentSnapshot,
  readRenderedLinesRange,
} from './terminal-output'
import type {
  TerminalAgentSnapshot,
  TerminalCreateOptions,
  TerminalSnapshot,
  TerminalState
} from '../shared/types'

const EXIT_FLUSH_MS = 250
const SCROLLBACK = 5000
const VSCODE_SHELL_INTEGRATION_OSC = 633

interface RenderedHistoryFlush {
  text: string
  flushedUntilRow: number
}

export interface ShellCommandFinishedEvent {
  exitCode?: number
}

export class Terminal {
  readonly id: number
  readonly shell: string
  readonly cwd: string
  readonly shellIntegration: boolean
  private readonly title: string

  private readonly pty: IPty
  private readonly headless: HeadlessTerminal
  private readonly serializeAddon = new SerializeAddon()
  private cols: number
  private rows: number
  private headlessWriteSequence = 0
  private completedHeadlessWriteSequence = 0
  private outputSeq = 0
  private headlessWriteWaiters: Array<{ sequence: number; resolve: () => void }> = []
  private commandRunning = false
  private exitCode: number | null = null
  private exited = false
  private pendingExit: number | null = null
  private exitTimer: NodeJS.Timeout | null = null
  private dataListeners = new Set<Listener<[string, number, number]>>()
  private exitListeners = new Set<Listener<[number]>>()
  private commandFinishedListeners = new Set<Listener<[ShellCommandFinishedEvent]>>()

  constructor(id: number, opts: TerminalCreateOptions = {}) {
    if (!opts.shell) throw new Error('Terminal shell is required')
    if (!opts.cwd) throw new Error('Terminal cwd is required')
    if (!existsSync(opts.cwd)) throw new Error(`Terminal cwd does not exist: ${opts.cwd}`)
    this.id = id
    this.shell = opts.shell
    this.cwd = opts.cwd
    this.shellIntegration = Boolean(opts.shellArgs?.length)
    this.title =
      opts.title ?? basename(this.shell, process.platform === 'win32' ? '.exe' : undefined)
    this.cols = opts.cols ?? 80
    this.rows = opts.rows ?? 24
    this.headless = new HeadlessTerminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true
    })
    this.headless.loadAddon(this.serializeAddon)
    this.headless.parser.registerOscHandler(VSCODE_SHELL_INTEGRATION_OSC, (data) => {
      this.handleVSCodeShellIntegration(data)
      return true
    })
    this.pty = spawn(this.shell, opts.shellArgs ?? [], {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: { ...process.env, ...opts.shellEnv }
    })

    this.pty.onData((data) => {
      const start = this.outputSeq
      const end = start + data.length
      this.outputSeq = end
      this.writeHeadless(data)
      if (this.pendingExit !== null) this.scheduleExit()
      for (const listener of this.dataListeners) listener(data, start, end)
    })
    this.pty.onExit(({ exitCode }) => {
      this.pendingExit = exitCode
      this.scheduleExit()
    })
  }

  bindData(callback: (data: string, start: number, end: number) => void): () => void {
    return addListener(this.dataListeners, callback)
  }

  bindExit(callback: (exitCode: number) => void): () => void {
    return addListener(this.exitListeners, callback)
  }

  bindCommandFinished(callback: (event: ShellCommandFinishedEvent) => void): () => void {
    return addListener(this.commandFinishedListeners, callback)
  }

  async snapshot(): Promise<TerminalSnapshot> {
    await this.flushHeadlessWrites()
    return {
      data: this.serializeAddon.serialize(),
      cols: this.cols,
      rows: this.rows,
      seq: this.outputSeq
    }
  }

  async agentSnapshot(): Promise<TerminalAgentSnapshot> {
    await this.flushHeadlessWrites()
    return readAgentSnapshot(this.headless)
  }

  async currentRenderedRow(): Promise<number> {
    await this.flushHeadlessWrites()
    const buffer = this.headless.buffer.active
    return buffer.baseY + buffer.cursorY
  }

  async flushRenderedRowsBeforeSnapshot(flushedUntilRow: number): Promise<RenderedHistoryFlush | null> {
    await this.flushHeadlessWrites()
    const buffer = this.headless.buffer.active
    if (buffer.type === 'alternate') return null
    const safeEnd = buffer.viewportY - 1
    const startRow = flushedUntilRow + 1
    if (safeEnd < startRow) return null
    return {
      text: readRenderedLinesRange(this.headless, startRow, safeEnd),
      flushedUntilRow: safeEnd
    }
  }

  write(data: string): void {
    if (!this.exited && this.pendingExit === null) this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return
    const nextCols = Math.max(cols, 1)
    const nextRows = Math.max(rows, 1)
    if (nextCols === this.cols && nextRows === this.rows) return
    try {
      this.pty.resize(nextCols, nextRows)
      this.headless.resize(nextCols, nextRows)
      this.cols = nextCols
      this.rows = nextRows
    } catch {
      // Ignore resize failures from terminals that are already exiting.
    }
  }

  close(): void {
    if (process.platform === 'win32') {
      this.kill()
      return
    }
    const pid = this.pty.pid
    try {
      this.pty.kill('SIGTERM')
    } catch {
      return
    }
    setTimeout(() => {
      try {
        process.kill(pid, 0)
        this.pty.kill('SIGKILL')
      } catch {
        // The process already exited.
      }
    }, 500).unref()
  }

  kill(): void {
    if (this.exitTimer) clearTimeout(this.exitTimer)
    try {
      this.pty.kill()
    } catch {
      // The process may already be gone.
    }
  }

  state(): TerminalState {
    return {
      id: this.id,
      pid: this.pty.pid,
      title: this.title,
      cwd: this.cwd,
      shell: this.shell,
      shellIntegration: this.shellIntegration || undefined,
      commandRunning: this.commandRunning || undefined,
      exitCode: this.exitCode
    }
  }

  private writeHeadless(data: string): void {
    const sequence = ++this.headlessWriteSequence
    this.headless.write(data, () => {
      this.completedHeadlessWriteSequence = sequence
      const ready = this.headlessWriteWaiters.filter((waiter) => waiter.sequence <= sequence)
      this.headlessWriteWaiters = this.headlessWriteWaiters.filter(
        (waiter) => waiter.sequence > sequence
      )
      for (const waiter of ready) waiter.resolve()
    })
  }

  private flushHeadlessWrites(): Promise<void> {
    const sequence = this.headlessWriteSequence
    if (this.completedHeadlessWriteSequence >= sequence) return Promise.resolve()
    return new Promise((resolve) => this.headlessWriteWaiters.push({ sequence, resolve }))
  }

  private handleVSCodeShellIntegration(data: string): void {
    const [command, ...args] = data.split(';')
    if (command === 'C' || command === 'E') {
      this.commandRunning = true
      return
    }
    if (command !== 'D') return
    this.commandRunning = false
    const rawExitCode = args[0]
    const exitCode = rawExitCode === undefined || rawExitCode === '' ? undefined : Number(rawExitCode)
    const event = {
      ...(Number.isFinite(exitCode) && { exitCode })
    }
    for (const listener of this.commandFinishedListeners) listener(event)
  }

  private scheduleExit(): void {
    if (this.exitTimer) clearTimeout(this.exitTimer)
    this.exitTimer = setTimeout(() => {
      this.exited = true
      this.exitCode = this.pendingExit
      for (const listener of this.exitListeners) listener(this.exitCode ?? 0)
    }, EXIT_FLUSH_MS)
  }
}
