import { existsSync } from 'node:fs'
import which from 'which'
import { larifyWorkspacePath } from '../../../main/utils/app-paths'
import { addListener, type Listener } from '../../../main/utils/listener'
import { TerminalManager } from './terminal-manager'
import type { TerminalRunLog } from './terminal-run-log'
import type {
  SessionTerminalsState,
  TerminalCreateOptions,
  TerminalAgentSnapshot,
  TerminalSnapshot
} from '../shared/types'

const DEFAULT_WORKSPACE = larifyWorkspacePath()

function shellCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['pwsh.exe', 'powershell.exe', process.env.COMSPEC, 'cmd.exe'].filter(
      Boolean
    ) as string[]
  }
  if (process.platform === 'darwin') {
    return [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean) as string[]
  }
  return [process.env.SHELL, '/bin/bash', '/bin/sh'].filter(Boolean) as string[]
}

function resolveShell(shell?: string): string {
  if (shell) return shell
  const candidates = shellCandidates()
  for (const candidate of candidates) {
    const found = which.sync(candidate, { nothrow: true })
    if (found) return found
  }
  return candidates[0]
}

function resolveCwd(cwd?: string): string {
  if (cwd && existsSync(cwd)) return cwd
  return DEFAULT_WORKSPACE
}

export class TerminalService {
  private managers = new Map<string, TerminalManager>()
  private changeListeners = new Set<Listener<[SessionTerminalsState]>>()
  private dataListeners = new Set<Listener<[string, number, string, number, number]>>()
  private exitListeners = new Set<Listener<[string, number, number]>>()

  bindChange(callback: (state: SessionTerminalsState) => void): () => void {
    return addListener(this.changeListeners, callback)
  }

  bindData(
    callback: (sessionId: string, terminalId: number, data: string, start: number, end: number) => void
  ): () => void {
    return addListener(this.dataListeners, callback)
  }

  bindExit(
    callback: (sessionId: string, terminalId: number, exitCode: number) => void
  ): () => void {
    return addListener(this.exitListeners, callback)
  }

  create(sessionId: string, opts?: TerminalCreateOptions): number {
    const shell = resolveShell(opts?.shell)
    return this.manager(sessionId).create({
      ...opts,
      cwd: resolveCwd(opts?.cwd),
      shell,
      title: opts?.title
    })
  }

  write(sessionId: string, terminalId: number, data: string): void {
    this.manager(sessionId).write(terminalId, data)
  }

  withWriterLock<T>(sessionId: string, terminalId: number, fn: () => Promise<T>): Promise<T> {
    return this.manager(sessionId).withWriterLock(terminalId, fn)
  }

  startRun(sessionId: string, terminalId: number): Promise<TerminalRunLog | null> {
    return this.manager(sessionId).startRun(terminalId)
  }

  flushRunHistory(sessionId: string, terminalId: number): Promise<TerminalRunLog | null> {
    return this.manager(sessionId).flushRunHistory(terminalId)
  }

  resize(sessionId: string, terminalId: number, cols: number, rows: number): void {
    this.manager(sessionId).resize(terminalId, cols, rows)
  }

  close(sessionId: string, terminalId: number): Promise<void> {
    return this.manager(sessionId).close(terminalId)
  }

  setActive(sessionId: string, terminalId: number): void {
    this.manager(sessionId).setActive(terminalId)
  }

  reorder(sessionId: string, terminalId: number, toIndex: number): void {
    this.manager(sessionId).reorder(terminalId, toIndex)
  }

  snapshot(sessionId: string, terminalId: number): Promise<TerminalSnapshot | null> {
    return this.manager(sessionId).snapshot(terminalId)
  }

  agentSnapshot(sessionId: string, terminalId: number): Promise<TerminalAgentSnapshot | null> {
    return this.manager(sessionId).agentSnapshot(terminalId)
  }

  terminalState(sessionId: string, terminalId: number) {
    return this.manager(sessionId).terminalState(terminalId)
  }

  state(sessionId: string): SessionTerminalsState {
    return this.manager(sessionId).state()
  }

  async destroySession(sessionId: string): Promise<void> {
    const manager = this.managers.get(sessionId)
    if (!manager) return
    await manager.destroy()
    this.managers.delete(sessionId)
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.managers.values()].map((manager) => manager.destroy()))
    this.managers.clear()
  }

  private manager(sessionId: string): TerminalManager {
    let manager = this.managers.get(sessionId)
    if (!manager) {
      manager = new TerminalManager(sessionId)
      manager.bindChange((state) => {
        for (const listener of this.changeListeners) listener(state)
      })
      manager.bindData((terminalId, data, start, end) => {
        for (const listener of this.dataListeners) listener(sessionId, terminalId, data, start, end)
      })
      manager.bindExit((terminalId, exitCode) => {
        for (const listener of this.exitListeners) listener(sessionId, terminalId, exitCode)
      })
      this.managers.set(sessionId, manager)
    }
    return manager
  }
}
