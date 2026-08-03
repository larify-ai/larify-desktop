import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Tool } from 'ai'

const mocks = vi.hoisted(() => {
  const registry = {
    addToolkit: vi.fn(),
    activeToolNames: vi.fn(() => ['agent_list_toolkit_tools']),
    toolSet: vi.fn(() => ({ test_tool: {} }))
  }
  return {
    registry,
    buildSystemPrompt: vi.fn(() => 'system prompt'),
    createAgentToolkit: vi.fn(() => ({ name: 'agent', tools: {} })),
    createToolRegistry: vi.fn(() => registry),
    runAgent: vi.fn(() => ({})),
    saveSession: vi.fn(),
    toolsContextFor: vi.fn((_tools, context) => ({ test_tool: context }))
  }
})

vi.mock('../../../../src/extensions/agent/main/agent', () => ({
  toolsContextFor: mocks.toolsContextFor
}))

vi.mock('../../../../src/extensions/agent/main/run-session', () => ({
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

vi.mock('../../../../src/extensions/agent/main/session-store', () => ({
  createSessionStore: () => ({ saveSession: mocks.saveSession })
}))

vi.mock('../../../../src/extensions/agent/main/agent-toolkit', () => ({
  createAgentToolkit: mocks.createAgentToolkit
}))

vi.mock('../../../../src/extensions/agent/main/registry', () => ({
  createToolRegistry: mocks.createToolRegistry
}))

vi.mock('../../../../src/extensions/agent/main/system-prompt', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt
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
  app.getAll.mockReturnValue([])
  mocks.runAgent.mockReturnValue({})
  mocks.registry.activeToolNames.mockReturnValue(['agent_list_toolkit_tools'])
  mocks.registry.toolSet.mockReturnValue({ test_tool: {} })
  mocks.createToolRegistry.mockReturnValue(mocks.registry)
  mocks.buildSystemPrompt.mockReturnValue('system prompt')
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

    expect(mocks.saveSession).toHaveBeenLastCalledWith(expect.any(String), partial, 'D:\\workspace')
  })

  it('uses an independent background session', async () => {
    const taskFile = task(join(root, 'runtime', 'task.md'), 'completed')

    await exec(input(taskFile))

    expect(mocks.toolsContextFor).toHaveBeenCalledWith(
      { test_tool: {} },
      { cwd: 'D:\\workspace', sessionId: expect.any(String) }
    )
    const options = mocks.runAgent.mock.calls[0][0]
    expect(options).toEqual(
      expect.objectContaining({
        system: 'system prompt',
        tools: { test_tool: {} },
        activeTools: ['agent_list_toolkit_tools']
      })
    )
    expect(mocks.buildSystemPrompt).toHaveBeenCalledWith(
      mocks.registry,
      'D:\\workspace',
      expect.anything(),
      undefined
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
