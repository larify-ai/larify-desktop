import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalService } from '../../../../src/extensions/terminal/main/terminal-service'

const spawnMock = vi.fn()
const logRoot = mkdtempSync(join(tmpdir(), 'larify-bash-replay-'))

vi.mock('node-pty', () => ({ spawn: spawnMock }))
vi.mock('which', () => ({ default: { sync: (name: string) => name } }))
vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (...segments: string[]) => join(logRoot, ...segments),
  larifyTempPath: (...segments: string[]) => join(logRoot, 'tmp', ...segments),
  larifyWorkspacePath: () => logRoot,
  resourcePath: (name: string) => join(logRoot, name)
}))

let emit: ((data: string) => void) | undefined
beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockReturnValue({
    pid: 1,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (data: string) => void) => {
      emit = cb
    },
    onExit: () => {}
  })
})
afterAll(() => rmSync(logRoot, { force: true, recursive: true }))

// Byte streams captured from Ubuntu bash 5.3.9 running the repo's bash integration.
const BASH_PROMPT = '\x1b]633;A\x07\x1b]633;B\x07'
const BASH_E_C = '\x1b]633;E;cd /tmp/IsaacLab;probe-nonce\x07\x1b]633;C\x07'
const BASH_OUTPUT = 'IsaacLab VERSION: 2.1.1\r\n---\r\nrobot_lab VERSION: 2.3.2\r\n'
const BASH_D_CODED = '\x1b]633;D;0\x07'
// bash emits a bare D for an empty command line: printf '\n' => 633;E;;<nonce> 633;C 633;D
const BASH_D_BARE = '\x1b]633;D\x07'

async function toolkit(): Promise<{
  service: TerminalService
  call: <T>(name: string, input: Record<string, unknown>) => Promise<T>
  id: number
}> {
  const { TerminalService } =
    await import('../../../../src/extensions/terminal/main/terminal-service')
  const { createTerminalToolkit } = await import('../../../../src/extensions/terminal/main/tools')
  const service = new TerminalService()
  const tools = createTerminalToolkit(service)
  const call = <T>(name: string, input: Record<string, unknown>): Promise<T> => {
    const tool = tools[name]
    const parsed = (tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(input)
    const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<T>
    return execute(parsed, {
      toolCallId: 't',
      messages: [],
      context: { sessionId: 'replay', cwd: logRoot }
    })
  }
  const creating = call<{ id: number }>('create', { cwd: logRoot })
  emit?.(BASH_PROMPT)
  const id = (await creating).id
  await new Promise((r) => setTimeout(r, 50))
  return { service, call, id }
}

describe('a real bash stream finishes the write', () => {
  it('settles on the exit-coded D of a chained command', async () => {
    const { service, call, id } = await toolkit()
    const pending = call<{ status: string }>('write', {
      id,
      input: 'cd x && echo a; echo ---; cd y && echo b',
      interrupt: false,
      timeout: 8,
      idle: 3
    })
    await new Promise((r) => setTimeout(r, 60))
    emit?.(`${BASH_E_C}${BASH_OUTPUT}${BASH_D_CODED}${BASH_PROMPT}`)

    await expect(pending).resolves.toMatchObject({
      status: 'shell integration command finish event received'
    })
    await service.destroy()
  }, 30_000)

  it('settles on a bare D instead of waiting out the timeout', async () => {
    const { service, call, id } = await toolkit()
    const startedAt = Date.now()
    const pending = call<{ status: string }>('write', {
      id,
      input: 'echo hello',
      interrupt: false,
      timeout: 8,
      idle: 3
    })
    await new Promise((r) => setTimeout(r, 60))
    emit?.(`${BASH_E_C}hello\r\n${BASH_D_BARE}${BASH_PROMPT}`)

    const result = await pending
    expect(result.status).toBe('shell integration command finish event received')
    expect(Date.now() - startedAt).toBeLessThan(4000)
    await service.destroy()
  }, 30_000)
})
