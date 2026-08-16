import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionTerminalsState,
  TerminalCreateOptions
} from '../../../../src/extensions/terminal/shared/types'
import { ResourceManager } from '../../../../src/main/core/resource'

const workspace = join(tmpdir(), 'larify-terminal-service-workspace')
const existingCwd = join(tmpdir(), 'larify-terminal-service-existing')
const managers: FakeManager[] = []
const whichSync = vi.fn()
const execFileSync = vi.fn()
const waitForShellIntegrationMock = vi.fn(() => Promise.resolve(true))
const originalShell = process.env.SHELL
let nextCreateError: Error | null = null

vi.mock('which', () => ({
  default: {
    sync: whichSync
  }
}))

vi.mock('node:child_process', () => ({ execFileSync }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'temp') return tmpdir()
      return tmpdir()
    }
  }
}))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  resourcePath: (...segments: string[]) => join(process.cwd(), 'resources', ...segments),
  larifyTempPath: (...segments: string[]) => {
    const path = join(tmpdir(), 'larify', ...segments)
    mkdirSync(path, { recursive: true })
    return path
  },
  larifyWorkspacePath: () => {
    mkdirSync(workspace, { recursive: true })
    return workspace
  }
}))

class FakeManager {
  readonly sessionId: string
  exitCode: number | null = null
  create = vi.fn(() => {
    if (nextCreateError) {
      const error = nextCreateError
      nextCreateError = null
      throw error
    }
    return 1
  })
  write = vi.fn()
  withWriterLock = vi.fn((_terminalId: number, fn: () => Promise<unknown>) => fn())
  resize = vi.fn()
  close = vi.fn()
  snapshot = vi.fn(() => 'snapshot')
  destroy = vi.fn()
  waitForShellIntegration = waitForShellIntegrationMock
  private changeCallbacks = new Set<(state: SessionTerminalsState) => void>()
  private dataCallbacks = new Set<
    (terminalId: number, data: string, start: number, end: number) => void
  >()
  private exitCallbacks = new Set<(terminalId: number, exitCode: number) => void>()
  private commandFinishedCallbacks = new Set<
    (terminalId: number, event: { exitCode?: number }) => void
  >()
  private commandStartedCallbacks = new Set<(terminalId: number) => void>()

  constructor(sessionId: string) {
    this.sessionId = sessionId
    managers.push(this)
  }

  bindChange(callback: (state: SessionTerminalsState) => void): () => void {
    this.changeCallbacks.add(callback)
    return () => this.changeCallbacks.delete(callback)
  }

  bindData(
    callback: (terminalId: number, data: string, start: number, end: number) => void
  ): () => void {
    this.dataCallbacks.add(callback)
    return () => this.dataCallbacks.delete(callback)
  }

  bindExit(callback: (terminalId: number, exitCode: number) => void): () => void {
    this.exitCallbacks.add(callback)
    return () => this.exitCallbacks.delete(callback)
  }

  bindCommandFinished(
    callback: (terminalId: number, event: { exitCode?: number }) => void
  ): () => void {
    this.commandFinishedCallbacks.add(callback)
    return () => this.commandFinishedCallbacks.delete(callback)
  }

  bindCommandStarted(callback: (terminalId: number) => void): () => void {
    this.commandStartedCallbacks.add(callback)
    return () => this.commandStartedCallbacks.delete(callback)
  }

  state(): SessionTerminalsState {
    return { sessionId: this.sessionId, terminals: [] }
  }

  terminalState(terminalId: number): {
    id: number
    pid: number
    title: string
    cwd: string
    shell: string
    exitCode: number | null
  } | null {
    const options = this.create.mock.calls.at(-1)?.[1]
    if (!options) return null
    return {
      id: terminalId,
      pid: 1000 + terminalId,
      title: options.title ?? 'Terminal',
      cwd: options.cwd ?? existingCwd,
      shell: options.shell ?? 'sh',
      exitCode: this.exitCode
    }
  }

  emitChange(): void {
    for (const callback of this.changeCallbacks) callback(this.state())
  }

  emitData(terminalId: number, data: string, start = 0, end = data.length): void {
    for (const callback of this.dataCallbacks) callback(terminalId, data, start, end)
  }

  emitExit(terminalId: number, exitCode: number): void {
    for (const callback of this.exitCallbacks) callback(terminalId, exitCode)
  }
}

vi.mock('../../../../src/extensions/terminal/main/terminal-manager', () => ({
  TerminalManager: FakeManager
}))

async function importService(): Promise<
  typeof import('../../../../src/extensions/terminal/main/terminal-service')
> {
  vi.resetModules()
  return import('../../../../src/extensions/terminal/main/terminal-service')
}

beforeEach(() => {
  managers.length = 0
  nextCreateError = null
  whichSync.mockReset()
  execFileSync.mockReset()
  execFileSync.mockReturnValue('')
  waitForShellIntegrationMock.mockReset()
  waitForShellIntegrationMock.mockResolvedValue(true)
  process.env.SHELL = originalShell
  rmSync(workspace, { force: true, recursive: true })
  mkdirSync(existingCwd, { recursive: true })
})

afterAll(() => {
  process.env.SHELL = originalShell
  rmSync(workspace, { force: true, recursive: true })
  rmSync(existingCwd, { force: true, recursive: true })
})

describe('TerminalService', () => {
  it.runIf(process.platform === 'win32')('prefers where.exe before which on Windows', async () => {
    execFileSync.mockImplementation((_file: string, [candidate]: string[]) =>
      candidate === 'pwsh.exe'
        ? [
            'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
            'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
          ].join('\r\n')
        : ''
    )
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1')

    expect(whichSync).not.toHaveBeenCalled()
    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        shell: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
        title: 'PowerShell'
      })
    )
  })

  it.runIf(process.platform === 'win32')(
    'falls back to which when where.exe cannot resolve a shell',
    async () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found')
      })
      whichSync.mockImplementation((candidate: string) =>
        candidate === 'pwsh.exe' ? 'C:\\PowerShell\\pwsh.exe' : null
      )
      const { TerminalService } = await importService()
      const service = new TerminalService()

      service.create('session-1')

      expect(whichSync).toHaveBeenCalledWith('pwsh.exe', { nothrow: true })
      expect(managers[0].create).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ shell: 'C:\\PowerShell\\pwsh.exe' })
      )
    }
  )

  it.runIf(process.platform === 'win32')(
    'detects a newly available default shell without restarting',
    async () => {
      let pwshAvailable = false
      execFileSync.mockImplementation((_file: string, [candidate]: string[]) => {
        if (candidate === 'pwsh.exe' && pwshAvailable) return 'C:\\PowerShell\\pwsh.exe\r\n'
        if (candidate === 'powershell.exe') {
          return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n'
        }
        throw new Error('not found')
      })
      whichSync.mockReturnValue(null)
      const { TerminalService } = await importService()
      const service = new TerminalService()

      service.create('session-1')
      pwshAvailable = true
      service.create('session-1')

      expect(managers[0].create.mock.calls.map(([, options]) => options.shell)).toEqual([
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\PowerShell\\pwsh.exe'
      ])
    }
  )

  it('uses the globally assigned resource id as the terminal id', async () => {
    whichSync.mockReturnValue('powershell.exe')
    const resources = new ResourceManager()
    resources.register('browser', () => ({ dispose: vi.fn() }))
    resources.create('browser', 'session-1')
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)

    expect(service.create('session-1')).toBe(2)
    expect(managers[0].create).toHaveBeenCalledWith(2, expect.any(Object))
    expect(resources.list().filter(({ type }) => type === 'terminal')).toEqual([
      { id: 2, type: 'terminal', sessionId: 'session-1' }
    ])

    await service.close('session-1', 2)
    expect(managers[0].close).toHaveBeenCalledWith(2)
    expect(resources.list().filter(({ type }) => type === 'terminal')).toEqual([])
  })

  it('does not close a resource owned by another type or session', async () => {
    const resources = new ResourceManager()
    const browserDispose = vi.fn()
    resources.register('browser', () => ({ dispose: browserDispose }))
    const browserId = resources.create('browser', 'session-1')
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)
    const otherTerminalId = service.create('session-2')

    await service.close('session-1', browserId)
    await service.close('session-1', otherTerminalId)

    expect(browserDispose).not.toHaveBeenCalled()
    expect(managers[0].close).not.toHaveBeenCalled()
    expect(resources.list()).toHaveLength(2)
  })

  it('resolves default cwd and shell before creating a terminal', async () => {
    whichSync.mockImplementation((candidate: string) =>
      candidate === 'powershell.exe'
        ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        : null
    )
    const { TerminalService } = await importService()
    const service = new TerminalService()

    expect(service.create('session-1')).toBe(1)

    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        cwd: workspace,
        shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        title: 'PowerShell',
        shellArgs: expect.arrayContaining([
          '-ExecutionPolicy',
          'Bypass',
          '-NoExit',
          expect.stringContaining('chcp.com 65001'),
          expect.stringContaining('[Console]::InputEncoding'),
          expect.stringContaining('[Console]::OutputEncoding'),
          expect.stringContaining('$OutputEncoding'),
          expect.stringContaining('resources\\shell-integration\\shellIntegration.ps1')
        ]),
        shellEnv: expect.objectContaining({
          LARIFY_ELECTRON_PATH: process.execPath,
          VSCODE_STABLE: '1'
        })
      })
    )
  })

  it('throws when the provided cwd does not exist instead of silently using the workspace', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    expect(() =>
      service.create('session-1', { cwd: join(tmpdir(), 'larify-cwd-does-not-exist-xyz') })
    ).toThrow('Working directory does not exist')
  })

  it('uses the default workspace when the renderer cwd is still empty', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { cwd: '' })

    expect(managers[0].create).toHaveBeenCalledWith(1, expect.objectContaining({ cwd: workspace }))
  })

  it('rejects an existing file as the working directory', async () => {
    const file = join(existingCwd, 'not-a-directory')
    writeFileSync(file, '')
    const { TerminalService } = await importService()
    const service = new TerminalService()

    expect(() => service.create('session-1', { cwd: file })).toThrow(
      'Working directory is not a directory'
    )
  })

  it('releases a newly created session manager when terminal creation fails', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()
    const failure = new Error('create failed')

    nextCreateError = failure

    expect(() => service.create('session-1', { shell: 'sh', cwd: existingCwd })).toThrow(failure)
    await vi.waitFor(() => expect(managers[0].destroy).toHaveBeenCalledOnce())
  })

  it('keeps an existing session manager when another terminal fails to create', async () => {
    const resources = new ResourceManager()
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    nextCreateError = new Error('create failed')

    expect(() => service.create('session-1', { shell: 'sh', cwd: existingCwd })).toThrow(
      'create failed'
    )

    expect(managers).toHaveLength(1)
    expect(managers[0].destroy).not.toHaveBeenCalled()
    expect(resources.list({ sessionId: 'session-1' })).toHaveLength(1)
  })

  it('releases an empty session manager after its last resource closes', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    const id = service.create('session-1')
    expect(managers).toHaveLength(1)

    await service.close('session-1', id)

    service.write('session-1', 1, 'echo')
    expect(service.terminalState('session-1', 1)).toBeNull()
    await expect(service.startRun('session-1', 1)).resolves.toBeNull()
    expect(service.state('session-1')).toEqual({
      sessionId: 'session-1',
      terminals: []
    })

    expect(managers[0].destroy).toHaveBeenCalledOnce()
    expect(managers).toHaveLength(1)
  })

  it('keeps provided shell, title, and existing cwd', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()
    const opts: TerminalCreateOptions = { shell: 'custom-shell', cwd: existingCwd, title: 'Custom' }

    service.create('session-1', opts)

    expect(whichSync).not.toHaveBeenCalled()
    expect(managers[0].create).toHaveBeenCalledWith(1, {
      shell: 'custom-shell',
      cwd: existingCwd,
      title: 'Custom',
      shellArgs: [],
      shellEnv: { LARIFY_ELECTRON_PATH: process.execPath }
    })
  })

  it('falls back to the platform baseline shell when no candidate resolves', async () => {
    whichSync.mockReturnValue(null)
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1')

    const expected =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.platform === 'darwin'
          ? '/bin/zsh'
          : '/bin/bash'
    const expectedTitle =
      process.platform === 'win32' ? 'PowerShell' : process.platform === 'darwin' ? 'Zsh' : 'Bash'
    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ shell: expected, title: expectedTitle })
    )
  })

  it.each([
    ['pwsh.exe', 'PowerShell'],
    ['cmd.exe', 'CMD'],
    ['/bin/bash', 'Bash'],
    ['/bin/zsh', 'Zsh']
  ])('derives the display title from %s', async (shell, title) => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { shell, cwd: existingCwd })

    expect(managers[0].create).toHaveBeenCalledWith(1, expect.objectContaining({ title }))
  })

  it('merges caller shellArgs and shellEnv with the integration options instead of overriding them', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', {
      shell: 'pwsh.exe',
      cwd: existingCwd,
      shellArgs: ['--caller-arg'],
      shellEnv: { CALLER_VAR: '1' }
    })

    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        shellArgs: expect.arrayContaining(['--caller-arg', '-NoLogo']),
        shellEnv: expect.objectContaining({ CALLER_VAR: '1', VSCODE_STABLE: '1' })
      })
    )
  })

  it('does not use unsupported SHELL as a default candidate', async () => {
    process.env.SHELL = '/bin/fish'
    whichSync.mockImplementation((candidate: string) =>
      candidate === 'pwsh.exe' ? 'pwsh.exe' : null
    )
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1')

    expect(whichSync).not.toHaveBeenCalledWith('/bin/fish', expect.anything())
    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        shell: 'pwsh.exe'
      })
    )
  })

  it('injects bash shell integration for bash', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { shell: '/bin/bash', cwd: existingCwd })

    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        shell: '/bin/bash',
        shellArgs: [
          '--init-file',
          expect.stringContaining(join(tmpdir(), 'larify', 'shell-integration', 'bash'))
        ],
        shellEnv: expect.objectContaining({
          LARIFY_ELECTRON_PATH: process.execPath,
          VSCODE_INJECTION: '1',
          VSCODE_NONCE: expect.any(String)
        })
      })
    )
  })

  it('reuses and removes copied shell integration resources', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { shell: '/bin/bash', cwd: existingCwd })
    service.create('session-1', { shell: '/bin/bash', cwd: existingCwd })

    const firstPath = managers[0].create.mock.calls[0][1].shellArgs?.[1]
    const secondPath = managers[0].create.mock.calls[1][1].shellArgs?.[1]
    expect(firstPath).toBe(secondPath)
    expect(firstPath && existsSync(firstPath)).toBe(true)

    await service.destroy()

    expect(firstPath && existsSync(dirname(firstPath))).toBe(false)
  })

  it('removes copied shell integration resources when manager destruction fails', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { shell: '/bin/bash', cwd: existingCwd })
    const scriptPath = managers[0].create.mock.calls[0][1].shellArgs?.[1]
    managers[0].destroy.mockRejectedValue(new Error('destroy failed'))

    await expect(service.destroy()).rejects.toThrow('destroy failed')
    expect(scriptPath && existsSync(dirname(scriptPath))).toBe(false)
  })

  it('unregisters its resource factory even when manager destruction fails', async () => {
    const resources = new ResourceManager()
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    managers[0].destroy.mockRejectedValue(new Error('destroy failed'))

    await expect(service.destroy()).rejects.toThrow('destroy failed')
    expect(() => resources.create('terminal', 'session-2')).toThrow(
      'Resource type "terminal" is not registered.'
    )
  })

  it('unregisters its resource factory before destruction finishes', async () => {
    const resources = new ResourceManager()
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    let finishDestroy!: () => void
    managers[0].destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve
        })
    )

    const destroying = service.destroy()
    await vi.waitFor(() => expect(finishDestroy).toBeTypeOf('function'))
    expect(() => resources.create('terminal', 'session-2')).toThrow(
      'Resource type "terminal" is not registered.'
    )

    finishDestroy()
    await destroying
  })

  it('closes a newly created terminal when readiness is aborted', async () => {
    const controller = new AbortController()
    waitForShellIntegrationMock.mockImplementation(
      (_id: number, _timeout: number, signal?: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          signal?.addEventListener('abort', () => resolve(false), { once: true })
        })
    )
    const { TerminalService } = await importService()
    const service = new TerminalService()

    const creating = service.createReady(
      'session-1',
      { shell: '/bin/bash', cwd: existingCwd },
      controller.signal
    )
    await vi.waitFor(() => expect(managers).toHaveLength(1))
    controller.abort()

    await expect(creating).rejects.toMatchObject({ name: 'AbortError' })
    expect(managers[0].close).toHaveBeenCalledWith(1)
  })

  it('closes a newly created terminal when readiness fails', async () => {
    waitForShellIntegrationMock.mockRejectedValue(new Error('readiness failed'))
    const { TerminalService } = await importService()
    const service = new TerminalService()

    await expect(
      service.createReady('session-1', { shell: '/bin/bash', cwd: existingCwd })
    ).rejects.toThrow('readiness failed')
    expect(managers[0].close).toHaveBeenCalledWith(1)
  })

  it('rejects a terminal that exits while shell integration is starting', async () => {
    let finishReadiness!: (ready: boolean) => void
    waitForShellIntegrationMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishReadiness = resolve
        })
    )
    const { TerminalService } = await importService()
    const service = new TerminalService()

    const creating = service.createReady('session-1', {
      shell: '/bin/bash',
      cwd: existingCwd
    })
    await vi.waitFor(() => expect(finishReadiness).toBeTypeOf('function'))
    managers[0].exitCode = 1
    finishReadiness(false)

    await expect(creating).rejects.toThrow('Terminal "1" exited during startup.')
    expect(managers[0].close).toHaveBeenCalledWith(1)
  })

  it('injects zsh shell integration through ZDOTDIR', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { shell: '/bin/zsh', cwd: existingCwd })

    expect(managers[0].create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        shell: '/bin/zsh',
        shellArgs: ['-i'],
        shellEnv: expect.objectContaining({
          LARIFY_ELECTRON_PATH: process.execPath,
          USER_ZDOTDIR: expect.any(String),
          VSCODE_INJECTION: '1',
          VSCODE_NONCE: expect.any(String),
          ZDOTDIR: expect.stringContaining(join(tmpdir(), 'larify', 'shell-integration', 'zsh'))
        })
      })
    )
  })

  it('reuses managers per session and forwards operations', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()

    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    service.write('session-1', 1, 'data')
    await expect(service.withWriterLock('session-1', 1, async () => 'locked')).resolves.toBe(
      'locked'
    )
    service.resize('session-1', 1, 80, 24)
    expect(service.snapshot('session-1', 1)).toBe('snapshot')
    await service.close('session-1', 1)
    await expect(service.snapshot('session-1', 1)).resolves.toBeNull()

    expect(managers).toHaveLength(1)
    expect(managers[0].write).toHaveBeenCalledWith(1, 'data')
    expect(managers[0].withWriterLock).toHaveBeenCalledWith(1, expect.any(Function))
    expect(managers[0].resize).toHaveBeenCalledWith(1, 80, 24)
    expect(managers[0].close).toHaveBeenCalledWith(1)
    expect(managers[0].snapshot).toHaveBeenCalledWith(1)
  })

  it('forwards manager events with session ids', async () => {
    const { TerminalService } = await importService()
    const resources = new ResourceManager()
    const service = new TerminalService(resources)
    const onChange = vi.fn()
    const onData = vi.fn()
    const onExit = vi.fn()
    service.bindChange(onChange)
    service.bindData(onData)
    service.bindExit(onExit)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })

    managers[0].emitChange()
    managers[0].emitData(1, 'output')
    managers[0].emitExit(1, 2)

    expect(onChange).toHaveBeenCalledWith({ sessionId: 'session-1', terminals: [] })
    expect(onData).toHaveBeenCalledWith('session-1', 1, 'output', 0, 6)
    expect(onExit).toHaveBeenCalledWith('session-1', 1, 2)
    await expect.poll(() => resources.get(1)).toBeUndefined()
  })

  it('supports multiple data listeners and unbinding', async () => {
    const { TerminalService } = await importService()
    const service = new TerminalService()
    const first = vi.fn()
    const second = vi.fn()
    service.bindData(first)
    const unbindSecond = service.bindData(second)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })

    managers[0].emitData(1, 'before')
    unbindSecond()
    managers[0].emitData(1, 'after')

    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith('session-1', 1, 'before', 0, 6)
  })

  it('destroys one session through the resource manager or all sessions with the service', async () => {
    const resources = new ResourceManager()
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    service.create('session-2', { shell: 'sh', cwd: existingCwd })

    await resources.destroy('session-1')
    expect(managers[0].destroy).toHaveBeenCalled()
    expect(managers[1].destroy).not.toHaveBeenCalled()

    await service.destroy()
    expect(managers[1].destroy).toHaveBeenCalled()
  })

  it('waits for every resource to close before destroying its session manager', async () => {
    const resources = new ResourceManager()
    const { TerminalService } = await importService()
    const service = new TerminalService(resources)
    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    service.create('session-1', { shell: 'sh', cwd: existingCwd })
    let finish!: () => void
    managers[0].close.mockImplementation((id: number) =>
      id === 1
        ? Promise.reject(new Error('close failed'))
        : new Promise<void>((resolve) => {
            finish = resolve
          })
    )

    const destroying = resources.destroy('session-1')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(managers[0].destroy).not.toHaveBeenCalled()

    finish()
    await destroying
    expect(managers[0].destroy).toHaveBeenCalledOnce()
  })
})
