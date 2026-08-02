import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createTaskDiagnosticsProvider } from '../../../../src/extensions/nest/main/diagnostics'

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'larify-tasks-'))
  roots.push(root)
  return root
}

function task(status = 'in_progress'): string {
  return `---\nname: Test\ndescription: Test task\nstatus: ${status}\n---\n\n# Events\n`
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('task diagnostics', () => {
  it('matches only task.md files inside the task root', () => {
    const root = createRoot()
    const provider = createTaskDiagnosticsProvider(root)

    expect(provider.matches(join(root, 'task.md'))).toBe(true)
    expect(provider.matches(join(root, 'child', 'task.md'))).toBe(true)
    expect(provider.matches(join(root, 'note.md'))).toBe(false)
    expect(provider.matches(join(root, '..', 'task.md'))).toBe(false)
  })

  it.each(['in_progress', 'completed'])('accepts the %s status', async (status) => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, task(status))

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.uri).toBe(pathToFileURL(file).href)
    expect(result.diagnostics).toEqual([])
  })

  it('reports invalid YAML frontmatter', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '---\nname: [\n---\n\n# Events\n')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual(['Invalid YAML frontmatter.'])
  })

  it('reports missing metadata and invalid status', async () => {
    const root = createRoot()
    const file = join(root, 'task.md')
    writeFileSync(file, '---\nname: " "\nstatus: pending\n---\n')

    const result = await createTaskDiagnosticsProvider(root).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Missing frontmatter field: name.',
      'Missing frontmatter field: description.',
      'Status must be in_progress or completed.'
    ])
  })
})
