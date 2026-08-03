import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createVerdictTool } from '../../../../src/extensions/nest/loop/verdict'
import { get } from '../../../../src/extensions/nest/utils/frontmatter'

const root = mkdtempSync(join(tmpdir(), 'larify-nest-verdict-'))
afterAll(() => rmSync(root, { force: true, recursive: true }))

function task(path: string, status = 'in_progress'): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `---\nname: Test\ndescription: Test task\nstatus: ${status}\n---\n`)
  return path
}

describe('nest verdict', () => {
  it('accepts schedule when a child is in progress', async () => {
    const parent = task(join(root, 'schedule', 'task.md'))
    task(join(root, 'schedule', 'child', 'task.md'))
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'schedule' }, {} as never)).resolves.toBe(
      'Verdict accepted: schedule.'
    )
    expect(verdict.result()).toBe('schedule')
  })

  it('rejects schedule without an in-progress child', async () => {
    const parent = task(join(root, 'no-child', 'task.md'))
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'schedule' }, {} as never)).resolves.toContain(
      'no scheduled task has status in_progress'
    )
    expect(verdict.result()).toBeUndefined()
  })

  it('rejects schedule when the current task is completed', async () => {
    const parent = task(join(root, 'completed-parent', 'task.md'), 'completed')
    task(join(root, 'completed-parent', 'child', 'task.md'))
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'schedule' }, {} as never)).resolves.toContain(
      'current task must have status in_progress'
    )
    expect(verdict.result()).toBeUndefined()
  })

  it('rejects terminate while an unfinished child remains', async () => {
    const parent = task(join(root, 'unfinished', 'task.md'))
    task(join(root, 'unfinished', 'child', 'task.md'))
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'terminate' }, {} as never)).resolves.toContain(
      'unfinished tasks remain'
    )
    expect(get(parent, 'status')).toBe('in_progress')
    expect(verdict.result()).toBeUndefined()
  })

  it('accepts multiple scheduled tasks', async () => {
    const parent = task(join(root, 'parallel', 'task.md'))
    task(join(root, 'parallel', 'first', 'task.md'))
    task(join(root, 'parallel', 'second', 'task.md'))
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'schedule' }, {} as never)).resolves.toBe(
      'Verdict accepted: schedule.'
    )
    expect(verdict.result()).toBe('schedule')
  })

  it('accepts a corrected verdict after rejection', async () => {
    const parent = task(join(root, 'corrected', 'task.md'))
    const verdict = createVerdictTool(parent)

    await verdict.tool.execute?.({ verdict: 'schedule' }, {} as never)
    task(join(root, 'corrected', 'child', 'task.md'))

    await expect(verdict.tool.execute?.({ verdict: 'schedule' }, {} as never)).resolves.toBe(
      'Verdict accepted: schedule.'
    )
    expect(verdict.result()).toBe('schedule')
  })

  it('rejects terminate while the current task is in progress', async () => {
    const parent = task(join(root, 'in-progress', 'task.md'))
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'terminate' }, {} as never)).resolves.toContain(
      'current task must have status completed'
    )
    expect(verdict.result()).toBeUndefined()
  })

  it('accepts terminate when the task and its children are completed', async () => {
    const parent = task(join(root, 'terminate', 'task.md'), 'completed')
    task(join(root, 'terminate', 'child', 'task.md'), 'completed')
    const verdict = createVerdictTool(parent)

    await expect(verdict.tool.execute?.({ verdict: 'terminate' }, {} as never)).resolves.toBe(
      'Verdict accepted: terminate.'
    )
    expect(get(parent, 'status')).toBe('completed')
    expect(verdict.result()).toBe('terminate')
  })
})
