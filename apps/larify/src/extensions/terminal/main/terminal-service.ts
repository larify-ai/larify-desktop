import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
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
  return candidates[0]
}

function resolveCwd(cwd?: string): string {
  if (cwd && existsSync(cwd)) return cwd
  return DEFAULT_WORKSPACE
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

function bashIntegrationScript(): string {
  const dir = createUniqueDir(larifyTempPath('shell-integration', 'bash'))
  const scriptPath = join(dir, 'shellIntegration-bash.sh')
  writeIntegrationScript(BASH_INTEGRATION_SCRIPT, scriptPath)
  return scriptPath
}

function zshIntegrationDir(): string {
  const dir = createUniqueDir(larifyTempPath('shell-integration', 'zsh'))
  chmodSync(dir, 0o1700)
  for (const [source, target] of ZSH_INTEGRATION_SCRIPTS) {
    writeIntegrationScript(source, join(dir, target))
  }
  return dir
}

function shellIntegrationOptions(shell: string): Pick<TerminalCreateOptions, 'shellArgs' | 'shellEnv'> {
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
      shellArgs: ['--init-file', bashIntegrationScript()],
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
        ZDOTDIR: zshIntegrationDir()
      }
    }
  }
  return {}
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
    return this.managers.get(sessionId).create({
      ...opts,
      ...shellIntegrationOptions(shell),
      cwd: resolveCwd(opts?.cwd),
      shell,
      title: opts?.title
    })
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
    await this.managers.destroyAll()
  }

  private manager(sessionId: string): TerminalManager | undefined {
    return this.managers.peek(sessionId)
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
