import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Tool } from 'ai'

const mocks = vi.hoisted(() => {
  return {
    runtime: vi.fn(() => ({
      system: 'system prompt',
      tools: { test_tool: {} },
      activeTools: ['agent_list_plugins'],
      toolsContext: { test_tool: {} }
    })),
    runAgent: vi.fn(() => ({})),
    saveSession: vi.fn()
  }
})

vi.mock('../../../../src/main/core/agent', () => ({
  runAgentSession: async (
    messages: unknown,
    options: { tools: Record<string, Tool>; [key: string]: unknown }
  ) => {
    const result = mocks.runAgent({ ...options, messages })
    const latest = result.latestMessages ?? messages
    return {
      result,
      messages: result.error ? Promise.reject(result.error) : Promise.resolve(latest),
      latest: () => latest
    }
  }
}))

vi.mock('../../../../src/main/core/agent/runtime', () => ({
  createAgentRuntime: mocks.runtime
}))

import { exec, type ExecInput } from '../../../../src/extensions/nest/loop/exec'
import { get } from '../../../../src/extensions/nest/utils/frontmatter'

const app = {
  get: vi.fn(),
  getAll: vi.fn(() => [])
}
const modelConfig = {
  modelId: 'deepseek-v4-flash',
  thinking: 'enabled'
} as const
const root = mkdtempSync(join(tmpdir(), 'larify-nest-exec-'))
afterAll(() => rmSync(root, { force: true, recursive: true }))

function task(path: string, status: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `---\nname: Test task\ndescription: Test description\nstatus: ${status}\n---\n`
  )
  return path
}

function input(taskFile: string): ExecInput {
  return {
    app: app as never,
    cwd: 'D:\\workspace',
    taskFile,
    prompt: 'loop prompt',
    modelConfig
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  app.get.mockImplementation((_kind, name) =>
    name === 'session'
      ? { saveSession: mocks.saveSession }
      : name === 'extension-host'
        ? {}
        : undefined
  )
  app.getAll.mockReturnValue([])
  mocks.runAgent.mockReturnValue({})
  mocks.runtime.mockClear()
})

describe('nest loop exec', () => {
  it('does not link a session that failed to save', async () => {
    const taskFile = task(join(root, 'save-failure', 'task.md'), 'in_progress')
    mocks.saveSession.mockRejectedValueOnce(new Error('save failed'))

    await expect(exec(input(taskFile))).rejects.toThrow('save failed')

    expect(get(taskFile, 'sessions')).toBeUndefined()
  })

  it('runs once without requiring a verdict', async () => {
    const taskFile = task(join(root, 'completed', 'task.md'), 'completed')

    await expect(exec(input(taskFile))).resolves.toBeUndefined()
    expect(get(taskFile, 'status')).toBe('completed')
  })

  it('saves partial messages when the user interrupts the run', async () => {
    const taskFile = task(join(root, 'interrupted', 'task.md'), 'in_progress')
    const partial = [
      { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] }
    ]
    mocks.runAgent.mockReturnValue({
      output: Promise.resolve(undefined),
      latestMessages: partial,
      error: new Error('aborted')
    })

    await expect(exec(input(taskFile))).rejects.toThrow('aborted')

    expect(mocks.saveSession).toHaveBeenLastCalledWith({
      id: expect.any(String),
      title: 'Test task',
      cwd: 'D:\\workspace',
      tasks: [taskFile],
      messages: partial
    })
  })

  it('uses an independent background session', async () => {
    const taskFile = task(join(root, 'runtime', 'task.md'), 'completed')

    await exec(input(taskFile))

    const options = mocks.runAgent.mock.calls[0][0]
    expect(options).toEqual(
      expect.objectContaining({
        system: 'system prompt',
        tools: { test_tool: {} },
        activeTools: ['agent_list_plugins']
      })
    )
    expect(mocks.runtime).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'D:\\workspace', template: expect.any(String) })
    )
    expect(get(taskFile, 'sessions')).toEqual([expect.any(String)])
  })

  it('ends after one agent run', async () => {
    const taskFile = task(join(root, 'missing-output', 'task.md'), 'in_progress')

    await expect(exec(input(taskFile))).resolves.toBeUndefined()
    expect(mocks.runAgent).toHaveBeenCalledOnce()
    expect(mocks.saveSession).toHaveBeenCalledTimes(2)
  })

  it('destroys resources owned by the background session', async () => {
    const taskFile = task(join(root, 'cleanup', 'task.md'), 'completed')
    const destroySession = vi.fn()
    app.getAll.mockImplementation((type) =>
      type === 'session-resource' ? [{ destroySession }] : []
    )

    await exec(input(taskFile))

    expect(destroySession).toHaveBeenCalledWith(expect.any(String))
  })
})
