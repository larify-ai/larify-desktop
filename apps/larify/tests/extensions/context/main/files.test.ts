import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isMarkdown,
  isWithin,
  markdownFiles,
  markdownLinks,
  resolveContextLink
} from '../../../../src/extensions/context/main/files'

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'larify-context-files-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('context files', () => {
  it('finds Markdown files recursively', () => {
    const root = createRoot()
    const nested = join(root, 'nested')
    mkdirSync(nested)
    writeFileSync(join(root, 'index.md'), '')
    writeFileSync(join(nested, 'subject.MD'), '')
    writeFileSync(join(nested, 'subject.txt'), '')

    expect(markdownFiles(root).sort()).toEqual(
      [join(root, 'index.md'), join(nested, 'subject.MD')].sort()
    )
    expect(markdownFiles(join(root, 'missing'))).toEqual([])
  })

  it.each([
    ['subject.md', true],
    ['subject.MD', true],
    ['subject.markdown', false],
    ['subject.md.txt', false]
  ])('identifies %s as Markdown: %s', (file, expected) => {
    expect(isMarkdown(file)).toBe(expected)
  })

  it('extracts inline and autolink links without images, code, or references', () => {
    const links = markdownLinks(
      [
        '[Inline](subject.md "Title")',
        '<https://example.com>',
        '![Image](image.png)',
        '`[Code](code.md)`',
        '[Reference][subject]',
        '[subject]: referenced.md'
      ].join('\n\n')
    )

    expect(links.map(({ url }) => url)).toEqual(['subject.md', 'https://example.com'])
  })

  it('checks path containment without confusing sibling prefixes', () => {
    const parent = createRoot()
    const root = join(parent, 'context')

    expect(isWithin(root, root)).toBe(true)
    expect(isWithin(root, join(root, 'subject.md'))).toBe(true)
    expect(isWithin(root, join(parent, 'context-other', 'subject.md'))).toBe(false)
    expect(isWithin(root, parent)).toBe(false)
  })

  it('resolves files, encoded names, queries, and fragments', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    const file = join(root, 'index.md')
    mkdirSync(root)

    expect(resolveContextLink(root, file, 'subject.md?view=full#section')).toBe(
      resolve(root, 'subject.md')
    )
    expect(resolveContextLink(root, file, '%E4%B8%AD%E6%96%87.md')).toBe(resolve(root, '中文.md'))
  })

  it('resolves context directories to index.md', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    const domain = join(root, 'domain')
    const file = join(root, 'index.md')
    mkdirSync(domain, { recursive: true })

    expect(resolveContextLink(root, file, 'domain/')).toBe(join(domain, 'index.md'))
  })

  it('allows workspace paths without rewriting external directories', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    const source = join(workspace, 'src')
    const file = join(root, 'index.md')
    mkdirSync(root)
    mkdirSync(source)

    expect(resolveContextLink(root, file, '../src/file.ts')).toBe(join(source, 'file.ts'))
    expect(resolveContextLink(root, file, '../src/')).toBe(source)
  })

  it('allows arbitrary local paths but rejects external URLs, anchors, and invalid encodings', () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    const file = join(root, 'index.md')
    mkdirSync(root)

    expect(resolveContextLink(root, file, '../../outside.md')).toBe(
      resolve(workspace, '..', 'outside.md')
    )
    expect(resolveContextLink(root, file, 'https://example.com')).toBeUndefined()
    expect(resolveContextLink(root, file, '#section')).toBeUndefined()
    expect(resolveContextLink(root, file, '%E0%A4%A')).toBeUndefined()
  })
})
