import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { set } from '../../../../src/extensions/nest/utils/frontmatter'
import { VerdictNotAcceptedError } from '../../../../src/extensions/nest/loop/verdict'

const mocks = vi.hoisted(() => ({
  exec: vi.fn()
}))

vi.mock('../../../../src/extensions/nest/loop/exec', () => ({
  exec: mocks.exec
}))

import { runLoop, type LoopInput } from '../../../../src/extensions/nest/loop/loop'

const root = mkdtempSync(join(tmpdir(), 'larify-nest-loop-'))
afterAll(() => rmSync(root, { force: true, recursive: true }))

function task(path: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '---\nname: Test\ndescription: Test task\nstatus: in_progress\n---\n')
  return path
}

const input = (rootTaskFile: string): LoopInput => ({
  app: { getAll: vi.fn(() => []) } as never,
  cwd: root,
  rootTaskFile,
  modelConfig: {
    modelId: 'deepseek-v4-flash',
    reasoningEffort: 'high'
  } as const
})

beforeEach(() => vi.clearAllMocks())

describe('nest loop', () => {
  it('completes children before their parent', async () => {
    const rootTask = task(join(root, 'ordered', 'task.md'))
    const childTask = task(join(root, 'ordered', 'child', 'task.md'))
    const order: string[] = []
    mocks.exec.mockImplementation(async ({ taskFile }: { taskFile: string }) => {
      order.push(taskFile)
      set(taskFile, 'status', 'completed')
      return 'terminate'
    })

    await runLoop(input(rootTask))

    expect(order).toEqual([childTask, rootTask])
    expect(mocks.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: `Follow the workflow for the current task: ${childTask}`
      })
    )
  })

  it('runs children in parallel', async () => {
    const rootTask = task(join(root, 'parallel', 'task.md'))
    const first = task(join(root, 'parallel', 'first', 'task.md'))
    const second = task(join(root, 'parallel', 'second', 'task.md'))
    const order: string[] = []
    const chunks: string[] = []
    let started = 0
    let release!: () => void
    const ready = new Promise<void>((resolve) => (release = resolve))
    mocks.exec.mockImplementation(
      async ({ taskFile, onChunk }: { taskFile: string; onChunk?: (chunk: never) => void }) => {
        order.push(taskFile)
        onChunk?.({} as never)
        if (taskFile !== rootTask) {
          started++
          if (started === 2) release()
          await ready
        }
        set(taskFile, 'status', 'completed')
      }
    )

    await runLoop({ ...input(rootTask), onChunk: (taskFile) => chunks.push(taskFile) })

    expect(started).toBe(2)
    expect(order).toEqual([first, second, rootTask])
    expect(chunks).toEqual([first, second, rootTask])
  })

  it('does not terminate a task with an unfinished child', async () => {
    const rootTask = task(join(root, 'scheduled', 'task.md'))
    const childTask = join(root, 'scheduled', 'child', 'task.md')
    const order: string[] = []
    mocks.exec.mockImplementation(async ({ taskFile }: { taskFile: string }) => {
      order.push(taskFile)
      if (taskFile === rootTask && order.length === 1) {
        task(childTask)
      } else {
        set(taskFile, 'status', 'completed')
      }
    })

    await runLoop(input(rootTask))

    expect(order).toEqual([rootTask, childTask, rootTask])
  })

  it('propagates child failures', async () => {
    const rootTask = task(join(root, 'failure', 'task.md'))
    task(join(root, 'failure', 'child', 'task.md'))
    const error = new Error('child failed')
    mocks.exec.mockRejectedValue(error)

    await expect(runLoop(input(rootTask))).rejects.toBe(error)
    expect(mocks.exec).toHaveBeenCalledTimes(3)
  })

  it('retries the current task after a temporary failure', async () => {
    const rootTask = task(join(root, 'retry', 'task.md'))
    mocks.exec
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockImplementationOnce(async () => set(rootTask, 'status', 'completed'))

    await expect(runLoop(input(rootTask))).resolves.toBeUndefined()
    expect(mocks.exec).toHaveBeenCalledTimes(2)
  })

  it('does not restart after verdict retries are exhausted', async () => {
    const rootTask = task(join(root, 'verdict-failure', 'task.md'))
    const error = new VerdictNotAcceptedError('missing verdict')
    mocks.exec.mockRejectedValue(error)

    await expect(runLoop(input(rootTask))).rejects.toBe(error)
    expect(mocks.exec).toHaveBeenCalledOnce()
  })

  it('does not retry after cancellation', async () => {
    const rootTask = task(join(root, 'cancelled', 'task.md'))
    const controller = new AbortController()
    const error = new Error('cancelled')
    mocks.exec.mockImplementationOnce(async () => {
      controller.abort()
      throw error
    })

    await expect(runLoop({ ...input(rootTask), signal: controller.signal })).rejects.toBe(error)

    expect(mocks.exec).toHaveBeenCalledOnce()
  })
})
