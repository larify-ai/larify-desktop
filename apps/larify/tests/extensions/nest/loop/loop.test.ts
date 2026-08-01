import { afterAll, describe, expect, it, vi } from 'vitest'
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
  sessionId: 'session',
  modelConfig: {
    modelId: 'deepseek-v4-flash',
    thinking: 'enabled'
  } as const
})

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
        prompt: `Follow the workflow for the task: ${childTask}`
      })
    )
  })

  it('propagates child failures', async () => {
    const rootTask = task(join(root, 'failure', 'task.md'))
    task(join(root, 'failure', 'child', 'task.md'))
    const error = new Error('child failed')
    mocks.exec.mockRejectedValue(error)

    await expect(runLoop(input(rootTask))).rejects.toBe(error)
  })
})
