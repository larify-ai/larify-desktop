import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import which from 'which'
import { larifyTempPath, larifyWorkspacePath, resourcePath } from '../../../main/utils/app-paths'
import { addListener, type Listener } from '../../../main/utils/listener'
import { SessionScopedManagers } from '../../../main/utils/session-scoped-managers'
import { createUniqueDir } from '../../../main/utils/unique-path'
import { TerminalManager } from './terminal-manager'
import type { ShellCommandFinishedEvent } from './terminal'
import type { TerminalRunLog } from './terminal-run-log'
import type {
  SessionTerminalsState,
  TerminalCreateOptions,
  TerminalAgentSnapshot,
  TerminalSnapshot,
  TerminalState
} from '../shared/types'

const DEFAULT_WORKSPACE = larifyWorkspacePath()
const POWERSHELL_INTEGRATION_SCRIPT = 'shell-integration/shellIntegration.ps1'
const POWERSHELL_UTF8_BOOTSTRAP = [
  'chcp.com 65001 > $null',
  '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)'
].join('; ')
const BASH_INTEGRATION_SCRIPT = 'shell-integration/shellIntegration-bash.sh'
const ZSH_INTEGRATION_SCRIPTS = [
  ['shell-integration/shellIntegration-env.zsh', '.zshenv'],
  ['shell-integration/shellIntegration-profile.zsh', '.zprofile'],
  ['shell-integration/shellIntegration-rc.zsh', '.zshrc'],
  ['shell-integration/shellIntegration-login.zsh', '.zlogin']
] as const
const SHELL_INTEGRATION_READY_TIMEOUT_MS = 10_000

function shellCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['pwsh.exe', 'powershell.exe']
  }
  const envShell = process.env.SHELL
  const supportedEnvShell = envShell && isShellIntegrationSupported(envShell) ? envShell : undefined
  if (process.platform === 'darwin') {
    return [supportedEnvShell, '/bin/zsh', '/bin/bash'].filter(Boolean) as string[]
  }
  return [supportedEnvShell, '/bin/bash', '/bin/zsh', 'pwsh'].filter(Boolean) as string[]
}

function resolveShell(shell?: string): string {
  if (shell) return shell
  const candidates = shellCandidates()
  for (const candidate of candidates) {
    const found = which.sync(candidate, { nothrow: true })
    if (found) return found
  }
  return fallbackShell()
}

function fallbackShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  if (process.platform === 'darwin') return '/bin/zsh'
  return '/bin/bash'
}

function resolveCwd(cwd?: string): string {
  if (cwd === undefined) return DEFAULT_WORKSPACE
  let directory = false
  try {
    directory = statSync(cwd).isDirectory()
  } catch {
    throw new Error(`Working directory does not exist: ${cwd}`)
  }
  if (!directory) throw new Error(`Working directory is not a directory: ${cwd}`)
  return cwd
}

function isPowerShell(shell: string): boolean {
  const name = basename(shell).toLowerCase()
  return name === 'powershell.exe' || name === 'pwsh.exe' || name === 'powershell' || name === 'pwsh'
}

function isBash(shell: string): boolean {
  const name = basename(shell).toLowerCase()
  return name === 'bash'
}

function isZsh(shell: string): boolean {
  return basename(shell).toLowerCase() === 'zsh'
}

function isShellIntegrationSupported(shell: string): boolean {
  return isPowerShell(shell) || isBash(shell) || isZsh(shell)
}

function writeIntegrationScript(source: string, target: string): void {
  const content = readFileSync(resourcePath(source), 'utf8').replace(/\r\n?/g, '\n')
  writeFileSync(target, content, 'utf8')
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export class TerminalService {
  private readonly managers = new SessionScopedManagers(
    (sessionId) => this.createManager(sessionId),
    (manager: TerminalManager) => manager.destroy()
  )
  private changeListeners = new Set<Listener<[SessionTerminalsState]>>()
  private dataListeners = new Set<Listener<[string, number, string, number, number]>>()
  private exitListeners = new Set<Listener<[string, number, number]>>()
  private commandFinishedListeners = new Set<Listener<[string, number, ShellCommandFinishedEvent]>>()
  private commandStartedListeners = new Set<Listener<[string, number]>>()
  private bashIntegrationPath: string | undefined
  private zshIntegrationPath: string | undefined

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

  bindCommandFinished(
    callback: (sessionId: string, terminalId: number, event: ShellCommandFinishedEvent) => void
  ): () => void {
    return addListener(this.commandFinishedListeners, callback)
  }

  bindCommandStarted(callback: (sessionId: string, terminalId: number) => void): () => void {
    return addListener(this.commandStartedListeners, callback)
  }

  create(sessionId: string, opts?: TerminalCreateOptions): number {
    const shell = resolveShell(opts?.shell)
    const integration = this.shellIntegrationOptions(shell)
    return this.managers.get(sessionId).create({
      ...opts,
      shell,
      cwd: resolveCwd(opts?.cwd),
      title: opts?.title,
      shellArgs: [...(opts?.shellArgs ?? []), ...(integration.shellArgs ?? [])],
      shellEnv: { ...opts?.shellEnv, ...integration.shellEnv }
    })
  }

  async createReady(
    sessionId: string,
    opts?: TerminalCreateOptions,
    signal?: AbortSignal
  ): Promise<number> {
    const terminalId = this.create(sessionId, opts)
    try {
      const state = this.terminalState(sessionId, terminalId)
      if (state && isShellIntegrationSupported(state.shell)) {
        await this.manager(sessionId)?.waitForShellIntegration(
          terminalId,
          SHELL_INTEGRATION_READY_TIMEOUT_MS,
          signal
        )
      }
    } catch (error) {
      await this.close(sessionId, terminalId)
      throw error
    }
    if (signal?.aborted) {
      await this.close(sessionId, terminalId)
      throw signal.reason instanceof Error ? signal.reason : new Error('Terminal creation was aborted.')
    }
    const readyState = this.terminalState(sessionId, terminalId)
    if (!readyState || readyState.exitCode !== null) {
      await this.close(sessionId, terminalId)
      throw new Error(`Terminal "${terminalId}" exited during startup.`)
    }
    return terminalId
  }

  write(sessionId: string, terminalId: number, data: string): void {
    this.manager(sessionId)?.write(terminalId, data)
  }

  withWriterLock<T>(sessionId: string, terminalId: number, fn: () => Promise<T>): Promise<T> {
    const manager = this.manager(sessionId)
    if (!manager) throw new Error(`Terminal "${terminalId}" not found.`)
    return manager.withWriterLock(terminalId, fn)
  }

  startRun(sessionId: string, terminalId: number): Promise<TerminalRunLog | null> {
    return this.manager(sessionId)?.startRun(terminalId) ?? Promise.resolve(null)
  }

  flushRunHistory(sessionId: string, terminalId: number): Promise<TerminalRunLog | null> {
    return this.manager(sessionId)?.flushRunHistory(terminalId) ?? Promise.resolve(null)
  }

  resize(sessionId: string, terminalId: number, cols: number, rows: number): void {
    this.manager(sessionId)?.resize(terminalId, cols, rows)
  }

  close(sessionId: string, terminalId: number): Promise<void> {
    return this.manager(sessionId)?.close(terminalId) ?? Promise.resolve()
  }

  setActive(sessionId: string, terminalId: number): void {
    this.manager(sessionId)?.setActive(terminalId)
  }

  reorder(sessionId: string, terminalId: number, toIndex: number): void {
    this.manager(sessionId)?.reorder(terminalId, toIndex)
  }

  snapshot(sessionId: string, terminalId: number): Promise<TerminalSnapshot | null> {
    return this.manager(sessionId)?.snapshot(terminalId) ?? Promise.resolve(null)
  }

  agentSnapshot(sessionId: string, terminalId: number): Promise<TerminalAgentSnapshot | null> {
    return this.manager(sessionId)?.agentSnapshot(terminalId) ?? Promise.resolve(null)
  }

  terminalState(sessionId: string, terminalId: number): TerminalState | null {
    return this.manager(sessionId)?.terminalState(terminalId) ?? null
  }

  state(sessionId: string): SessionTerminalsState {
    return this.manager(sessionId)?.state() ?? { sessionId, terminals: [], activeId: null }
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.managers.destroySession(sessionId)
  }

  async destroy(): Promise<void> {
    try {
      await this.managers.destroyAll()
    } finally {
      this.cleanupShellIntegration()
    }
  }

  private manager(sessionId: string): TerminalManager | undefined {
    return this.managers.peek(sessionId)
  }

  private shellIntegrationOptions(
    shell: string
  ): Pick<TerminalCreateOptions, 'shellArgs' | 'shellEnv'> {
    if (isPowerShell(shell)) {
      const integrationScript = resourcePath(POWERSHELL_INTEGRATION_SCRIPT)
      return {
        shellArgs: [
          '-NoLogo',
          '-ExecutionPolicy',
          'Bypass',
          '-NoExit',
          '-Command',
          `${POWERSHELL_UTF8_BOOTSTRAP}; . ${powerShellLiteral(integrationScript)}`
        ],
        shellEnv: {
          VSCODE_NONCE: randomUUID(),
          VSCODE_STABLE: '1'
        }
      }
    }
    if (isBash(shell)) {
      return {
        shellArgs: ['--init-file', this.bashIntegrationScript()],
        shellEnv: {
          VSCODE_INJECTION: '1',
          VSCODE_NONCE: randomUUID()
        }
      }
    }
    if (isZsh(shell)) {
      return {
        shellArgs: ['-i'],
        shellEnv: {
          USER_ZDOTDIR: process.env.ZDOTDIR || homedir(),
          VSCODE_INJECTION: '1',
          VSCODE_NONCE: randomUUID(),
          ZDOTDIR: this.zshIntegrationDir()
        }
      }
    }
    return {}
  }

  private bashIntegrationScript(): string {
    if (this.bashIntegrationPath) return this.bashIntegrationPath
    const dir = createUniqueDir(larifyTempPath('shell-integration', 'bash'))
    try {
      chmodSync(dir, 0o700)
      const scriptPath = join(dir, 'shellIntegration-bash.sh')
      writeIntegrationScript(BASH_INTEGRATION_SCRIPT, scriptPath)
      this.bashIntegrationPath = scriptPath
      return scriptPath
    } catch (error) {
      rmSync(dir, { force: true, recursive: true })
      throw error
    }
  }

  private zshIntegrationDir(): string {
    if (this.zshIntegrationPath) return this.zshIntegrationPath
    const dir = createUniqueDir(larifyTempPath('shell-integration', 'zsh'))
    try {
      chmodSync(dir, 0o1700)
      for (const [source, target] of ZSH_INTEGRATION_SCRIPTS) {
        writeIntegrationScript(source, join(dir, target))
      }
      this.zshIntegrationPath = dir
      return dir
    } catch (error) {
      rmSync(dir, { force: true, recursive: true })
      throw error
    }
  }

  private cleanupShellIntegration(): void {
    const paths = [
      this.bashIntegrationPath && dirname(this.bashIntegrationPath),
      this.zshIntegrationPath
    ]
    this.bashIntegrationPath = undefined
    this.zshIntegrationPath = undefined
    for (const path of paths) {
      if (path) rmSync(path, { force: true, recursive: true })
    }
  }

  private createManager(sessionId: string): TerminalManager {
    const manager = new TerminalManager(sessionId)
    manager.bindChange((state) => {
      for (const listener of this.changeListeners) listener(state)
    })
    manager.bindData((terminalId, data, start, end) => {
      for (const listener of this.dataListeners) listener(sessionId, terminalId, data, start, end)
    })
    manager.bindExit((terminalId, exitCode) => {
      for (const listener of this.exitListeners) listener(sessionId, terminalId, exitCode)
    })
    manager.bindCommandFinished((terminalId, event) => {
      for (const listener of this.commandFinishedListeners) listener(sessionId, terminalId, event)
    })
    manager.bindCommandStarted((terminalId) => {
      for (const listener of this.commandStartedListeners) listener(sessionId, terminalId)
    })
    return manager
  }
}
