import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphIndex } from '../../../../src/extensions/context/main/graph'
import {
  buildContextGraph,
  indexContext,
  updateContext
} from '../../../../src/extensions/context/main/indexer'

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'larify-context-index-'))
  roots.push(root)
  return root
}

function markdown(name: string, body = ''): string {
  return `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}\n\n${body}\n`
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('context graph indexer', () => {
  it('builds and incrementally updates a graph from Markdown', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    const a = join(root, 'a.md')
    const b = join(root, 'b.md')
    writeFileSync(a, markdown('A', '[B](b.md)'))
    writeFileSync(b, markdown('B'))

    const graph = buildContextGraph(root, ':memory:')
    expect(graph.nodes().map(({ name }) => name)).toEqual(['A', 'B'])
    expect(graph.edges()).toEqual([
      {
        source: 'A',
        target: 'B'
      }
    ])

    writeFileSync(b, markdown('B', '[A](a.md)'))
    updateContext(root, [b], graph)
    expect(graph.edges()).toHaveLength(2)

    unlinkSync(b)
    updateContext(root, [b], graph)
    expect(graph.nodes().map(({ name }) => name)).toEqual(['A'])
    expect(graph.nodes()[0].uri).toBe(pathToFileURL(resolve(a)).href)

    graph.close()
  })

  it('reindexes a document moved without changing its name', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    const first = join(root, 'first.md')
    const second = join(root, 'second.md')
    writeFileSync(first, markdown('Same'))
    const graph = new GraphIndex(':memory:')
    indexContext(root, graph)

    renameSync(first, second)
    indexContext(root, graph)

    expect(graph.nodes()).toEqual([
      {
        name: 'Same',
        description: 'Same',
        uri: pathToFileURL(second).href
      }
    ])
    graph.close()
  })

  it('excludes invalid and duplicate documents', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    writeFileSync(join(root, 'a.md'), markdown('Same'))
    writeFileSync(join(root, 'b.md'), markdown('same'))
    writeFileSync(join(root, 'invalid.md'), '# Missing metadata')

    const graph = buildContextGraph(root, ':memory:')

    expect(graph.nodes()).toHaveLength(1)
    expect(graph.nodes()[0].name).toBe('Same')
    graph.close()
  })

  it('removes stale data when an update introduces a duplicate name', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    const a = join(root, 'a.md')
    const b = join(root, 'b.md')
    writeFileSync(a, markdown('A'))
    writeFileSync(b, markdown('B'))
    const graph = buildContextGraph(root, ':memory:')

    writeFileSync(b, markdown('A'))
    updateContext(root, [b], graph)

    expect(graph.nodes().map(({ name }) => name)).toEqual(['A'])
    expect(graph.search('B')).toEqual([])

    writeFileSync(a, markdown('C'))
    updateContext(root, [a], graph)

    expect(graph.nodes().map(({ name }) => name)).toEqual(['A', 'C'])
    expect(graph.node(pathToFileURL(b).href)?.name).toBe('A')
    graph.close()
  })

  it('activates an existing edge when its target is added incrementally', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    const a = join(root, 'a.md')
    const b = join(root, 'b.md')
    writeFileSync(a, markdown('A', '[B](b.md)'))
    const graph = buildContextGraph(root, ':memory:')
    expect(graph.edges()).toEqual([])

    writeFileSync(b, markdown('B'))
    updateContext(root, [b], graph)

    expect(graph.edges()).toEqual([{ source: 'A', target: 'B' }])
    graph.close()
  })

  it('indexes context directory links but not workspace file links', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    const domain = join(root, 'domain')
    mkdirSync(root)
    mkdirSync(domain)
    writeFileSync(
      join(root, 'index.md'),
      markdown('Index', '[Domain](domain/)\n[Source](../source.ts)')
    )
    writeFileSync(join(domain, 'index.md'), markdown('Domain'))
    writeFileSync(join(workspace, 'source.ts'), 'export {}')

    const graph = buildContextGraph(root, ':memory:')

    expect(graph.edges()).toEqual([{ source: 'Index', target: 'Domain' }])
    graph.close()
  })

  it('ignores external, anchored, non-Markdown, and out-of-context links', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    writeFileSync(
      join(root, 'index.md'),
      markdown(
        'Index',
        [
          '[Internal](internal.md)',
          '[External](https://example.com)',
          '[Anchor](#section)',
          '[Text](note.txt)',
          '[Workspace](../outside.md)'
        ].join('\n')
      )
    )
    writeFileSync(join(root, 'internal.md'), markdown('Internal'))
    writeFileSync(join(root, 'note.txt'), 'text')
    writeFileSync(join(workspace, 'outside.md'), markdown('Outside'))

    const graph = buildContextGraph(root, ':memory:')

    expect(graph.edges()).toEqual([{ source: 'Index', target: 'Internal' }])
    graph.close()
  })

  it('recovers when two existing documents exchange names', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    mkdirSync(root)
    const a = join(root, 'a.md')
    const b = join(root, 'b.md')
    writeFileSync(a, markdown('A'))
    writeFileSync(b, markdown('B'))
    const graph = buildContextGraph(root, ':memory:')

    writeFileSync(a, markdown('B'))
    writeFileSync(b, markdown('A'))
    updateContext(root, [a, b], graph)

    expect(graph.node(pathToFileURL(a).href)?.name).toBe('B')
    expect(graph.node(pathToFileURL(b).href)?.name).toBe('A')
    graph.close()
  })

  it('builds an empty graph when the context directory is absent', () => {
    const root = join(createRoot(), 'missing')
    const graph = buildContextGraph(root, ':memory:')

    expect(graph.nodes()).toEqual([])
    expect(graph.edges()).toEqual([])
    graph.close()
  })

  it('closes the graph when initial indexing fails', () => {
    const root = join(createRoot(), 'memory')
    writeFileSync(root, 'not a directory')
    const close = vi.spyOn(GraphIndex.prototype, 'close')

    expect(() => buildContextGraph(root, ':memory:')).toThrow()
    expect(close).toHaveBeenCalledOnce()
    close.mockRestore()
  })
})
