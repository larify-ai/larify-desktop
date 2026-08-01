import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
    runAgent: vi.fn(),
    toolsContextFor: vi.fn((_tools, context) => ({ test_tool: context }))
  }
})

vi.mock('../../../../src/extensions/agent/main/agent', () => ({
  runAgent: mocks.runAgent,
  toolsContextFor: mocks.toolsContextFor
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

import { exec } from '../../../../src/extensions/nest/loop/exec'
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

function task(path: string, status: 'in_progress' | 'completed'): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `---\nname: Test task\ndescription: Test description\nstatus: ${status}\n---\n`
  )
  return path
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registry.activeToolNames.mockReturnValue(['agent_list_toolkit_tools'])
  mocks.registry.toolSet.mockReturnValue({ test_tool: {} })
  mocks.createToolRegistry.mockReturnValue(mocks.registry)
  mocks.buildSystemPrompt.mockReturnValue('system prompt')
})

describe('nest loop exec', () => {
  it.each(['schedule', 'terminate'] as const)(
    'returns the structured %s verdict',
    async (verdict) => {
      const rootTask = task(join(root, verdict, 'task.md'), 'in_progress')
      const childTask =
        verdict === 'schedule'
          ? task(join(root, verdict, 'child', 'task.md'), 'completed')
          : undefined
      mocks.runAgent.mockReturnValue({
        output: Promise.resolve(
          verdict === 'schedule' ? { verdict, taskFiles: ['child/task.md'] } : { verdict }
        )
      })

      await expect(
        exec({
          app: app as never,
          cwd: 'D:\\workspace',
          taskFile: rootTask,
          prompt: 'loop prompt',
          sessionId: 'parent-session',
          modelConfig
        })
      ).resolves.toBe(verdict)

      expect(get(childTask ?? rootTask, 'status')).toBe(
        verdict === 'schedule' ? 'in_progress' : 'completed'
      )
    }
  )

  it('reuses the parent session for tool resources', async () => {
    const rootTask = task(join(root, 'resources', 'task.md'), 'in_progress')
    mocks.runAgent.mockReturnValue({
      output: Promise.resolve({ verdict: 'terminate' })
    })

    await exec({
      app: app as never,
      cwd: 'D:\\workspace',
      taskFile: rootTask,
      prompt: 'loop prompt',
      sessionId: 'parent-session',
      modelConfig
    })

    expect(mocks.toolsContextFor).toHaveBeenCalledWith(
      { test_tool: {} },
      {
        cwd: 'D:\\workspace',
        sessionId: 'parent-session'
      }
    )
    expect(mocks.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'loop prompt' }],
        system: 'system prompt',
        output: expect.anything(),
        prepareStep: expect.any(Function),
        deepseekOptions: { thinking: { type: 'enabled' } }
      })
    )
    expect(mocks.buildSystemPrompt).toHaveBeenCalledWith(
      mocks.registry,
      'D:\\workspace',
      expect.anything(),
      expect.stringContaining('# Workflow')
    )
  })

  it('propagates structured output failures', async () => {
    const rootTask = task(join(root, 'failure', 'task.md'), 'in_progress')
    const error = new Error('invalid structured output')
    mocks.runAgent.mockReturnValue({
      output: Promise.reject(error)
    })

    await expect(
      exec({
        app: app as never,
        cwd: 'D:\\workspace',
        taskFile: rootTask,
        prompt: 'loop prompt',
        sessionId: 'parent-session',
        modelConfig
      })
    ).rejects.toBe(error)
  })

  it('retries an invalid schedule with the validation error', async () => {
    const rootTask = task(join(root, 'retry', 'task.md'), 'in_progress')
    const childTask = task(join(root, 'retry', 'child', 'task.md'), 'completed')
    mocks.runAgent
      .mockReturnValueOnce({
        output: Promise.resolve({
          verdict: 'schedule',
          taskFiles: ['missing/task.md']
        }),
        responseMessages: Promise.resolve([{ role: 'assistant', content: 'first verdict' }])
      })
      .mockReturnValueOnce({
        output: Promise.resolve({
          verdict: 'schedule',
          taskFiles: ['child/task.md']
        })
      })

    await expect(
      exec({
        app: app as never,
        cwd: 'D:\\workspace',
        taskFile: rootTask,
        prompt: 'loop prompt',
        sessionId: 'parent-session',
        modelConfig
      })
    ).resolves.toBe('schedule')

    expect(get(childTask, 'status')).toBe('in_progress')
    expect(mocks.runAgent).toHaveBeenCalledTimes(2)
    expect(mocks.runAgent.mock.calls[1]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Scheduled task.md does not exist')
        })
      ])
    )
  })

  it('requires scheduled tasks to have a name and description', async () => {
    const rootTask = task(join(root, 'metadata', 'task.md'), 'in_progress')
    const childTask = join(root, 'metadata', 'child', 'task.md')
    mkdirSync(dirname(childTask), { recursive: true })
    writeFileSync(childTask, '---\nname: Child\n---\n')

    mocks.runAgent
      .mockReturnValueOnce({
        output: Promise.resolve({
          verdict: 'schedule',
          taskFiles: ['child/task.md']
        }),
        responseMessages: Promise.resolve([{ role: 'assistant', content: 'first verdict' }])
      })
      .mockImplementationOnce(() => {
        task(childTask, 'completed')
        return {
          output: Promise.resolve({
            verdict: 'schedule',
            taskFiles: ['child/task.md']
          })
        }
      })

    await expect(
      exec({
        app: app as never,
        cwd: 'D:\\workspace',
        taskFile: rootTask,
        prompt: 'loop prompt',
        sessionId: 'parent-session',
        modelConfig
      })
    ).resolves.toBe('schedule')

    expect(mocks.runAgent.mock.calls[1]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('must have a description')
        })
      ])
    )
  })

  it('rejects task files created for unscheduled tasks', async () => {
    const rootTask = task(join(root, 'unscheduled', 'task.md'), 'in_progress')
    const scheduledTask = task(join(root, 'unscheduled', 'scheduled', 'task.md'), 'completed')
    const unscheduledTask = join(root, 'unscheduled', 'unscheduled', 'task.md')
    mkdirSync(dirname(unscheduledTask), { recursive: true })
    writeFileSync(
      unscheduledTask,
      '---\nname: Unscheduled task\ndescription: Unscheduled description\n---\n'
    )

    mocks.runAgent
      .mockReturnValueOnce({
        output: Promise.resolve({
          verdict: 'schedule',
          taskFiles: ['scheduled/task.md']
        }),
        responseMessages: Promise.resolve([{ role: 'assistant', content: 'first verdict' }])
      })
      .mockImplementationOnce(() => {
        task(unscheduledTask, 'completed')
        return {
          output: Promise.resolve({
            verdict: 'schedule',
            taskFiles: ['scheduled/task.md']
          })
        }
      })

    await expect(
      exec({
        app: app as never,
        cwd: 'D:\\workspace',
        taskFile: rootTask,
        prompt: 'loop prompt',
        sessionId: 'parent-session',
        modelConfig
      })
    ).resolves.toBe('schedule')

    expect(get(scheduledTask, 'status')).toBe('in_progress')
    expect(mocks.runAgent.mock.calls[1]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('Do not create task.md for an unscheduled task')
        })
      ])
    )
  })

  it('does not terminate with an unscheduled in-progress task', async () => {
    const rootTask = task(join(root, 'terminate-unscheduled', 'task.md'), 'in_progress')
    const childTask = task(
      join(root, 'terminate-unscheduled', 'child', 'task.md'),
      'in_progress'
    )

    mocks.runAgent
      .mockReturnValueOnce({
        output: Promise.resolve({ verdict: 'terminate' }),
        responseMessages: Promise.resolve([{ role: 'assistant', content: 'first verdict' }])
      })
      .mockImplementationOnce(() => {
        task(childTask, 'completed')
        return { output: Promise.resolve({ verdict: 'terminate' }) }
      })

    await expect(
      exec({
        app: app as never,
        cwd: 'D:\\workspace',
        taskFile: rootTask,
        prompt: 'loop prompt',
        sessionId: 'parent-session',
        modelConfig
      })
    ).resolves.toBe('terminate')

    expect(mocks.runAgent.mock.calls[1]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('Do not create task.md for an unscheduled task')
        })
      ])
    )
  })
})
