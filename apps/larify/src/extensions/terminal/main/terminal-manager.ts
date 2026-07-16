import { addListener, type Listener } from "../../../main/utils/listener"
import { Terminal } from "./terminal"
import type { SessionTerminalsState, TerminalCreateOptions, TerminalSnapshot } from "../shared/types"

export class TerminalManager {
  private terminals = new Map<number, Terminal>()
  private activeId: number | null = null
  private nextId = 1
  private changeListeners = new Set<Listener<[SessionTerminalsState]>>()
  private dataListeners = new Set<Listener<[number, string]>>()
  private exitListeners = new Set<Listener<[number, number]>>()

  constructor(private readonly sessionId: string) {}

  bindChange(callback: (state: SessionTerminalsState) => void): () => void {
    return addListener(this.changeListeners, callback)
  }

  bindData(callback: (terminalId: number, data: string) => void): () => void {
    return addListener(this.dataListeners, callback)
  }

  bindExit(callback: (terminalId: number, exitCode: number) => void): () => void {
    return addListener(this.exitListeners, callback)
  }

  create(opts?: TerminalCreateOptions): number {
    const terminal = new Terminal(this.nextId++, opts)
    terminal.bindData((data) => {
      for (const listener of this.dataListeners) listener(terminal.id, data)
    })
    terminal.bindExit((exitCode) => {
      for (const listener of this.exitListeners) listener(terminal.id, exitCode)
      this.emit()
    })
    this.terminals.set(terminal.id, terminal)
    this.activeId = terminal.id
    this.emit()
    return terminal.id
  }

  write(id: number, data: string): void {
    this.terminals.get(id)?.write(data)
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

  close(id: number): void {
    const terminal = this.terminals.get(id)
    if (!terminal) return

    const order = [...this.terminals.keys()]
    const index = order.indexOf(id)
    terminal.close()
    this.terminals.delete(id)
    if (this.activeId === id) {
      const remaining = [...this.terminals.keys()]
      this.activeId = remaining[index] ?? remaining[index - 1] ?? null
    }
    this.emit()
  }

  state(): SessionTerminalsState {
    return {
      sessionId: this.sessionId,
      terminals: [...this.terminals.values()].map((terminal) => terminal.state()),
      activeId: this.activeId,
    }
  }

  destroy(): void {
    for (const terminal of this.terminals.values()) terminal.kill()
    this.terminals.clear()
    this.activeId = null
    this.emit()
  }

  private emit(): void {
    const state = this.state()
    for (const listener of this.changeListeners) listener(state)
  }
}
