import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { set } from '../../../../src/extensions/nest/utils/frontmatter'

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
    thinking: 'enabled'
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

  it('runs children sequentially', async () => {
    const rootTask = task(join(root, 'sequential', 'task.md'))
    const first = task(join(root, 'sequential', 'first', 'task.md'))
    const second = task(join(root, 'sequential', 'second', 'task.md'))
    const order: string[] = []
    mocks.exec.mockImplementation(async ({ taskFile }: { taskFile: string }) => {
      order.push(taskFile)
      set(taskFile, 'status', 'completed')
    })

    await runLoop(input(rootTask))

    expect(order).toEqual([first, second, rootTask])
  })

  it('propagates child failures', async () => {
    const rootTask = task(join(root, 'failure', 'task.md'))
    task(join(root, 'failure', 'child', 'task.md'))
    const error = new Error('child failed')
    mocks.exec.mockRejectedValue(error)

    await expect(runLoop(input(rootTask))).rejects.toBe(error)
    expect(mocks.exec).toHaveBeenCalledTimes(3)
  })

  it('retries the current task after a failure', async () => {
    const rootTask = task(join(root, 'retry', 'task.md'))
    mocks.exec
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockImplementationOnce(async () => {
        set(rootTask, 'status', 'completed')
        return 'terminate'
      })

    await expect(runLoop(input(rootTask))).resolves.toBeUndefined()

    expect(mocks.exec).toHaveBeenCalledTimes(2)
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
