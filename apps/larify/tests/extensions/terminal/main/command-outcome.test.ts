import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalService } from '../../../../src/extensions/terminal/main/terminal-service'

const spawnMock = vi.fn()
const logRoot = mkdtempSync(join(tmpdir(), 'larify-outcome-'))

vi.mock('node-pty', () => ({ spawn: spawnMock }))
vi.mock('which', () => ({ default: { sync: (name: string) => name } }))
vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (...segments: string[]) => join(logRoot, ...segments),
  larifyTempPath: (...segments: string[]) => join(logRoot, 'tmp', ...segments),
  larifyWorkspacePath: () => logRoot,
  resourcePath: (name: string) => join(logRoot, name)
}))

const OSC = {
  prompt: '\x1b]633;A\x07\x1b]633;B\x07',
  started: (line = 'command') => `\x1b]633;E;${line}\x07\x1b]633;C\x07`,
  done: (code: string) => `\x1b]633;D;${code}\x07`
}

let emit: ((data: string) => void) | undefined
let fireExit: ((event: { exitCode: number }) => void) | undefined
let written: string[]
type ToolkitCall = <T>(name: string, input: Record<string, unknown>) => Promise<T>

beforeEach(() => {
  written = []
  spawnMock.mockReset()
  spawnMock.mockReturnValue({
    pid: 1,
    write: vi.fn((data: string) => written.push(data)),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (data: string) => void) => {
      emit = cb
    },
    onExit: (cb: (event: { exitCode: number }) => void) => {
      fireExit = cb
    }
  })
})

afterAll(() => rmSync(logRoot, { force: true, recursive: true }))

async function boot(): Promise<{ service: TerminalService; call: ToolkitCall; id: number }> {
  const { TerminalService } =
    await import('../../../../src/extensions/terminal/main/terminal-service')
  const { createTerminalToolkit } = await import('../../../../src/extensions/terminal/main/tools')
  const service = new TerminalService()
  const toolkit = createTerminalToolkit(service)
  const call = <T>(name: string, input: Record<string, unknown>): Promise<T> => {
    const tool = toolkit[name]
    const parsed = (tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(input)
    const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<T>
    return execute(parsed, {
      toolCallId: 't',
      messages: [],
      context: { sessionId: 'outcome', cwd: logRoot }
    })
  }
  const creating = call<{ id: number }>('create', { cwd: logRoot })
  emit?.(OSC.prompt)
  const id = (await creating).id
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { service, call, id }
}

const runCommand = async (
  call: ToolkitCall,
  id: number,
  exitCode: string
): Promise<{ status: string }> => {
  const pending = call<{ status: string }>('write', {
    id,
    input: 'some command',
    submit: true,
    timeout: 8,
    idle: 1
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  emit?.(`${OSC.started('cmd')}output line\r\n${OSC.done(exitCode)}${OSC.prompt}`)
  return pending
}

describe('the agent is told when a command finished', () => {
  it('reports the finish event once the shell announces it', async () => {
    const { service, call, id } = await boot()

    const result = await runCommand(call, id, '7')

    expect(result.status).toBe('shell integration command finish event received')
    await service.destroy()
  }, 30_000)

  it('says the command may still be running when nothing finished', async () => {
    const { service, call, id } = await boot()

    const result = await call<{ status: string }>('write', {
      id,
      input: '\x1b[B',
      submit: false,
      timeout: 3,
      idle: 1
    })

    expect(result.status).toContain('may still be running')
    await service.destroy()
  }, 30_000)
})

describe('reading an idle terminal does not wait', () => {
  it('reports the finish and returns at once once the prompt is back', async () => {
    const { service, call, id } = await boot()

    await runCommand(call, id, '0')
    const startedAt = Date.now()

    const result = await call<{ status: string }>('read', { id, timeout: 60, idle: 30 })

    expect(result.status).toBe('shell integration command finish event received')
    expect(Date.now() - startedAt).toBeLessThan(3000)
    await service.destroy()
  }, 30_000)

  it('still waits for a command that is running when the read arrives', async () => {
    const { service, call, id } = await boot()
    const writing = runCommand(call, id, '0')
    await new Promise((resolve) => setTimeout(resolve, 60))

    const reading = call<{ status: string }>('read', { id, timeout: 8, idle: 1 })
    await new Promise((resolve) => setTimeout(resolve, 400))

    await expect(reading).resolves.toMatchObject({
      status: 'shell integration command finish event received'
    })
    await writing
    await service.destroy()
  }, 30_000)
})

describe('an interrupt write never inherits the finish of the command it interrupts', () => {
  it('keeps waiting when the interrupted long command ends after our write', async () => {
    const { service, call, id } = await boot()
    emit?.(`${OSC.started('cmd')}LAUNCH\r\n`)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const pending = call<{ status: string }>('write', {
      id,
      input: 'next command',
      submit: true,
      interrupt: true,
      timeout: 8,
      idle: 5
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    emit?.(`${OSC.done('0')}${OSC.prompt}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
    emit?.(`${OSC.started('cmd')}NEXT\r\n${OSC.done('0')}${OSC.prompt}`)

    await expect(pending).resolves.toMatchObject({
      status: 'shell integration command finish event received'
    })
    await service.destroy()
  }, 30_000)

  it('reports pending while the interrupt leaves only the old bare finish behind', async () => {
    const { service, call, id } = await boot()
    emit?.(`${OSC.started('cmd')}LAUNCH\r\n`)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const pending = call<{ status: string }>('write', {
      id,
      input: 'next command',
      submit: true,
      interrupt: true,
      timeout: 2,
      idle: 1
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    emit?.(`${OSC.started('cmd')}\r\n\x1b]633;D\x07${OSC.prompt}`)

    await expect(pending).resolves.toMatchObject({
      status: 'command may still be running or waiting for input'
    })
    await service.destroy()
  }, 30_000)
})

describe('waiting only happens when a finish signal can actually arrive', () => {
  it('does not report a stale finish while answering a running command', async () => {
    const { service, call, id } = await boot()
    emit?.(OSC.started('cmd'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(service.terminalState('outcome', id)?.commandRunning).toBe(true)

    const result = await call<{ status: string }>('write', {
      id,
      input: '\x1b[B',
      submit: false,
      timeout: 3,
      idle: 1
    })

    expect(result.status).toContain('may still be running')
    await service.destroy()
  }, 30_000)

  it('presses enter for an empty submit and waits for the command it starts', async () => {
    const { service, call, id } = await boot()

    const pending = call<{ status: string }>('write', {
      id,
      input: '',
      submit: true,
      timeout: 8,
      idle: 5
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(written.at(-1)).toBe('\r')
    emit?.(`${OSC.started('cmd')}${OSC.done('0')}${OSC.prompt}`)

    expect((await pending).status).toBe('shell integration command finish event received')
    await service.destroy()
  }, 30_000)

  it('falls back to the idle window when the agent sends nothing', async () => {
    const { service, call, id } = await boot()
    emit?.(OSC.started('cmd'))
    await new Promise((resolve) => setTimeout(resolve, 100))

    const startedAt = Date.now()
    const result = await call<{ status: string }>('write', {
      id,
      input: '',
      submit: false,
      timeout: 8,
      idle: 1
    })

    expect(result.status).toContain('may still be running')
    expect(Date.now() - startedAt).toBeLessThan(4000)
    await service.destroy()
  }, 30_000)

  it('does not wait for a finish from a shell that never announced itself', async () => {
    const { TerminalService } =
      await import('../../../../src/extensions/terminal/main/terminal-service')
    const { createTerminalToolkit } = await import('../../../../src/extensions/terminal/main/tools')
    const service = new TerminalService()
    const toolkit = createTerminalToolkit(service)
    const call = <T>(name: string, input: Record<string, unknown>): Promise<T> => {
      const tool = toolkit[name]
      const parsed = (tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(
        input
      )
      const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<T>
      return execute(parsed, {
        toolCallId: 't',
        messages: [],
        context: { sessionId: 'silent', cwd: logRoot }
      })
    }
    const id = service.create('silent', { cwd: logRoot })
    const startedAt = Date.now()

    await call('write', { id, input: 'echo hi', submit: true, timeout: 8, idle: 1 })

    expect(Date.now() - startedAt).toBeLessThan(4000)
    await service.destroy()
  }, 30_000)
})

describe('a terminal whose shell has exited leaves the list', () => {
  it('disappears from list once the shell is gone', async () => {
    const { service, call, id } = await boot()
    expect(await call<unknown[]>('list', {})).toHaveLength(1)

    fireExit?.({ exitCode: 3 })
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(await call<unknown[]>('list', {})).toHaveLength(0)
    expect(service.terminalState('outcome', id)).toBeNull()
    await service.destroy()
  }, 30_000)

  it('still answers the write whose own command ended the shell', async () => {
    const { service, call, id } = await boot()

    const pending = call<{ status: string; snapshot: { screen: string } }>('write', {
      id,
      input: 'exit',
      submit: true,
      timeout: 8,
      idle: 1
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    emit?.(`${OSC.started('cmd')}goodbye\r\n`)
    fireExit?.({ exitCode: 0 })

    const result = await pending
    expect(result.status).toBe('terminal exited before a shell integration command finish event')
    expect(result.snapshot.screen).toContain('goodbye')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(await call<unknown[]>('list', {})).toHaveLength(0)
    await service.destroy()
  }, 30_000)

  it('refuses a write instead of dropping it and waiting', async () => {
    const { service, call, id } = await boot()
    fireExit?.({ exitCode: 3 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const before = written.length
    const startedAt = Date.now()

    await expect(
      call('write', { id, input: 'echo hi', submit: true, timeout: 8, idle: 1 })
    ).rejects.toThrow(`Terminal "${id}" not found.`)

    expect(Date.now() - startedAt).toBeLessThan(2000)
    expect(written.length).toBe(before)
    await service.destroy()
  }, 30_000)

  it('refuses a read instead of waiting on a dead terminal', async () => {
    const { service, call, id } = await boot()
    fireExit?.({ exitCode: 0 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const startedAt = Date.now()

    await expect(call('read', { id, timeout: 8, idle: 5 })).rejects.toThrow(
      `Terminal "${id}" not found.`
    )

    expect(Date.now() - startedAt).toBeLessThan(2000)
    await service.destroy()
  }, 30_000)
})
