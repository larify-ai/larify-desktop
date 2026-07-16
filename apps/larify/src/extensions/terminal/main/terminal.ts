import { existsSync } from "node:fs"
import { basename } from "node:path"
import { SerializeAddon } from "@xterm/addon-serialize"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import { spawn, type IPty } from "node-pty"
import { addListener, type Listener } from "../../../main/utils/listener"
import type { TerminalCreateOptions, TerminalSnapshot, TerminalState } from "./types"

const EXIT_FLUSH_MS = 250
const SCROLLBACK = 5000

export class Terminal {
  readonly id: number
  readonly shell: string
  readonly cwd: string
  readonly title: string

  private readonly pty: IPty
  private readonly headless: HeadlessTerminal
  private readonly serializeAddon = new SerializeAddon()
  private cols: number
  private rows: number
  private headlessWriteSequence = 0
  private completedHeadlessWriteSequence = 0
  private headlessWriteWaiters: Array<{ sequence: number; resolve: () => void }> = []
  private exitCode: number | null = null
  private exited = false
  private pendingExit: number | null = null
  private exitTimer: NodeJS.Timeout | null = null
  private dataListeners = new Set<Listener<[string]>>()
  private exitListeners = new Set<Listener<[number]>>()

  constructor(id: number, opts: TerminalCreateOptions = {}) {
    if (!opts.shell) throw new Error("Terminal shell is required")
    if (!opts.cwd) throw new Error("Terminal cwd is required")
    if (!existsSync(opts.cwd)) throw new Error(`Terminal cwd does not exist: ${opts.cwd}`)
    this.id = id
    this.shell = opts.shell
    this.cwd = opts.cwd
    this.title = opts.title ?? basename(this.shell, process.platform === "win32" ? ".exe" : undefined)
    this.cols = opts.cols ?? 80
    this.rows = opts.rows ?? 24
    this.headless = new HeadlessTerminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    })
    this.headless.loadAddon(this.serializeAddon)
    this.pty = spawn(this.shell, [], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: process.env,
    })

    this.pty.onData((data) => {
      this.writeHeadless(data)
      if (this.pendingExit !== null) this.scheduleExit()
      for (const listener of this.dataListeners) listener(data)
    })
    this.pty.onExit(({ exitCode }) => {
      this.pendingExit = exitCode
      this.scheduleExit()
    })
  }

  bindData(callback: (data: string) => void): () => void {
    return addListener(this.dataListeners, callback)
  }

  bindExit(callback: (exitCode: number) => void): () => void {
    return addListener(this.exitListeners, callback)
  }

  async snapshot(): Promise<TerminalSnapshot> {
    await this.flushHeadlessWrites()
    return {
      data: this.serializeAddon.serialize(),
      cols: this.cols,
      rows: this.rows,
    }
  }

  write(data: string): void {
    if (!this.exited && this.pendingExit === null) this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return
    const nextCols = Math.max(cols, 1)
    const nextRows = Math.max(rows, 1)
    try {
      this.pty.resize(nextCols, nextRows)
      this.headless.resize(nextCols, nextRows)
      this.cols = nextCols
      this.rows = nextRows
    } catch {
    }
  }

  close(): void {
    if (process.platform === "win32") {
      this.kill()
      return
    }
    const pid = this.pty.pid
    try {
      this.pty.kill("SIGTERM")
    } catch {
      return
    }
    setTimeout(() => {
      try {
        process.kill(pid, 0)
        this.pty.kill("SIGKILL")
      } catch {
      }
    }, 500).unref()
  }

  kill(): void {
    if (this.exitTimer) clearTimeout(this.exitTimer)
    try {
      this.pty.kill()
    } catch {
    }
  }

  state(): TerminalState {
    return {
      id: this.id,
      pid: this.pty.pid,
      title: this.title,
      cwd: this.cwd,
      shell: this.shell,
      exitCode: this.exitCode,
    }
  }

  private writeHeadless(data: string): void {
    const sequence = ++this.headlessWriteSequence
    this.headless.write(data, () => {
      this.completedHeadlessWriteSequence = sequence
      const ready = this.headlessWriteWaiters.filter((waiter) => waiter.sequence <= sequence)
      this.headlessWriteWaiters = this.headlessWriteWaiters.filter(
        (waiter) => waiter.sequence > sequence,
      )
      for (const waiter of ready) waiter.resolve()
    })
  }

  private flushHeadlessWrites(): Promise<void> {
    const sequence = this.headlessWriteSequence
    if (this.completedHeadlessWriteSequence >= sequence) return Promise.resolve()
    return new Promise((resolve) => this.headlessWriteWaiters.push({ sequence, resolve }))
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
