import { existsSync } from "node:fs"
import { basename } from "node:path"
import { spawn, type IPty } from "node-pty"
import { addListener, type Listener } from "../../../main/utils/listener"
import type { TerminalCreateOptions, TerminalState } from "./types"

const EXIT_FLUSH_MS = 250
const SNAPSHOT_CAP = 1024 * 1024

export class Terminal {
  readonly id: number
  readonly shell: string
  readonly cwd: string
  readonly title: string

  private readonly pty: IPty
  private snapshotChunks: string[] = []
  private snapshotSize = 0
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
    this.pty = spawn(this.shell, [], {
      name: "xterm-256color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: this.cwd,
      env: process.env,
    })

    this.pty.onData((data) => {
      this.pushSnapshot(data)
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

  snapshot(): string {
    return this.snapshotChunks.join("")
  }

  write(data: string): void {
    if (!this.exited && this.pendingExit === null) this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return
    try {
      this.pty.resize(Math.max(cols, 1), Math.max(rows, 1))
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

  private pushSnapshot(data: string): void {
    if (data.length >= SNAPSHOT_CAP) {
      this.snapshotChunks = [data.slice(-SNAPSHOT_CAP)]
      this.snapshotSize = this.snapshotChunks[0].length
      return
    }

    this.snapshotChunks.push(data)
    this.snapshotSize += data.length
    while (this.snapshotSize > SNAPSHOT_CAP) {
      const overflow = this.snapshotSize - SNAPSHOT_CAP
      const first = this.snapshotChunks[0]
      if (first.length <= overflow) {
        this.snapshotChunks.shift()
        this.snapshotSize -= first.length
      } else {
        this.snapshotChunks[0] = first.slice(overflow)
        this.snapshotSize -= overflow
      }
    }
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
