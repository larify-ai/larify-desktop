import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createTaskDiagnosticsProvider } from '../../../../src/extensions/context/main/task-diagnostics'

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'larify-task-'))
  roots.push(root)
  return root
}

function taskMarkdown(status = 'pending'): string {
  return `---\nname: 任务标题\ndescription: 任务描述\nstatus: ${status}\n---\n\n# 目标\n`
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('task diagnostics', () => {
  it('matches only task.md files inside the tasks root', () => {
    const root = createRoot()
    const provider = createTaskDiagnosticsProvider(root)
    const sub = join(root, 'sub')

    mkdirSync(sub)
    expect(provider.matches(join(root, 'task.md'))).toBe(true)
    expect(provider.matches(join(sub, 'task.md'))).toBe(true)
    expect(provider.matches(join(root, 'plan.md'))).toBe(false)
    expect(provider.matches(join(root, 'task.txt'))).toBe(false)
    expect(provider.matches(join(root, '..', 'task.md'))).toBe(false)
  })

  it('returns a file URI with diagnostics', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '# no frontmatter')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.uri).toBe(pathToFileURL(file).href)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('accepts a valid task.md', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, taskMarkdown('completed'))

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics).toEqual([])
  })

  it('reports missing name and description', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '---\nstatus: pending\n---')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Missing frontmatter field: name.',
      'Missing frontmatter field: description.'
    ])
  })

  it('reports empty or non-string metadata fields', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '---\nname: " "\ndescription: 42\nstatus: pending\n---')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Missing frontmatter field: name.',
      'Missing frontmatter field: description.'
    ])
  })

  it.each(['foo', 'done', 'in_progress', ''] as const)(
    'rejects invalid status `%s`',
    async (status) => {
      const root = createRoot()
      const file = join(root, 'task.md')
      writeFileSync(file, taskMarkdown(status))

      const result = await createTaskDiagnosticsProvider(root).provide(file)

      expect(result.diagnostics.map(({ message }) => message)).toEqual([
        'Frontmatter field "status" must be one of: pending | completed.'
      ])
    }
  )

  it('reports a missing status alongside other fields', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '---\nname: 任务\ndescription: 描述\n---')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Frontmatter field "status" must be one of: pending | completed.'
    ])
  })

  it('reports invalid YAML frontmatter', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '---\nname: [\n---')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toContain('Invalid YAML frontmatter.')
  })

  it('returns empty diagnostics for a non-existent file', async () => {
    const root = createRoot()
    const file = join(root, 'missing.md')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics).toEqual([])
  })
})
