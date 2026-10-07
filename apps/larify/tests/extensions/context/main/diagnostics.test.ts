import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticSeverity } from 'vscode-languageserver-protocol'
import { createContextDiagnosticsProvider } from '../../../../src/extensions/context/main/diagnostics'

const roots: string[] = []
const noDuplicate = async (): Promise<boolean> => false

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'larify-context-'))
  roots.push(root)
  return root
}

function markdown(name: string, body = '', description = `About ${name}`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('context diagnostics', () => {
  it('matches only Markdown files inside the context root', () => {
    const root = createRoot()
    const provider = createContextDiagnosticsProvider(root, noDuplicate)

    expect(provider.matches(join(root, 'subject.md'))).toBe(true)
    expect(provider.matches(join(root, 'subject.txt'))).toBe(false)
    expect(provider.matches(join(root, '..', 'subject.md'))).toBe(false)
  })

  it('returns LSP diagnostics with a file URI', async () => {
    const root = createRoot()
    const file = join(root, 'subject.md')
    writeFileSync(file, '# Missing metadata')

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.uri).toBe(pathToFileURL(file).href)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: DiagnosticSeverity.Error,
          message: 'Missing frontmatter field: name.'
        })
      ])
    )
  })

  it('accepts external URLs and encoded Chinese links', async () => {
    const root = createRoot()
    const index = join(root, 'index.md')
    const subject = join(root, '中文主题.md')
    writeFileSync(
      index,
      markdown(
        'Index',
        '[主题](%E4%B8%AD%E6%96%87%E4%B8%BB%E9%A2%98.md?view=full#section)\n[External](https://example.com)'
      )
    )
    writeFileSync(subject, markdown('中文主题', '[Index](index.md)'))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(index)

    expect(result.diagnostics).toEqual([])
  })

  it('accepts anchors and non-HTTP external URLs', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(
      file,
      markdown(
        'Index',
        '[Section](#section)\n[Email](mailto:test@example.com)\n[FTP](ftp://example.com/file)'
      )
    )

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics).toEqual([])
  })

  it('reports invalid external URLs', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, markdown('Index', '[Invalid](https://[)'))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Invalid external URL: https://[.'
    ])
  })

  it('reports empty metadata fields', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, '---\nname: " "\ndescription: 42\n---')

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Missing frontmatter field: name.',
      'Missing frontmatter field: description.'
    ])
  })

  it('reports a description that is too long', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, markdown('Index', '', 'x'.repeat(301)))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Description is too long: 301 > 300 characters. Keep it a short retrieval summary.'
    ])
  })

  it('accepts a description at the length threshold', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, markdown('Index', '', 'x'.repeat(300)))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics).toEqual([])
  })

  it('checks a trimmed name for duplication', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    const duplicateName = vi.fn(async () => true)
    writeFileSync(file, markdown('  Same  '))

    const result = await createContextDiagnosticsProvider(root, duplicateName).provide(file)

    expect(duplicateName).toHaveBeenCalledOnce()
    expect(duplicateName).toHaveBeenCalledWith(file, 'Same')
    expect(result.diagnostics.map(({ message }) => message)).toContain('Name must be unique: Same.')
  })

  it('reports duplicate names and broken links', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, markdown('Same', '[Target](target.md)\n[Missing](missing.md)'))
    writeFileSync(join(root, 'target.md'), markdown('Target'))
    writeFileSync(join(root, 'duplicate.md'), markdown('Same'))

    const result = await createContextDiagnosticsProvider(
      root,
      async (_file, name) => name.toLowerCase() === 'same'
    ).provide(file)
    const messages = result.diagnostics.map(({ message }) => message)

    expect(messages).toEqual(
      expect.arrayContaining([
        'Name must be unique: Same.',
        'Link target does not exist: missing.md.'
      ])
    )
  })

  it('does not report missing names as duplicates', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, '---\ndescription: Index\n---')
    writeFileSync(join(root, 'other.md'), '---\ndescription: Other\n---')

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)
    const messages = result.diagnostics.map(({ message }) => message)

    expect(messages).toContain('Missing frontmatter field: name.')
    expect(messages.some((message) => message.startsWith('Name must be unique:'))).toBe(false)
  })

  it('preserves other diagnostics when duplicate lookup fails', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, markdown('Index', '[Missing](missing.md)'))

    const result = await createContextDiagnosticsProvider(root, async () => {
      throw new Error('Index unavailable')
    }).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Link target does not exist: missing.md.'
    ])
  })

  it('resolves directory links and rejects missing links', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    const subdomain = join(root, 'subdomain')
    mkdirSync(subdomain)
    writeFileSync(join(subdomain, 'index.md'), markdown('Subdomain', '[Index](../index.md)'))
    writeFileSync(file, markdown('Index', '[Subdomain](subdomain/)\n[Outside](../outside.md)'))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Link target does not exist: ../outside.md.'
    ])
  })

  it('requires an index file for a linked context directory', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    const empty = join(root, 'empty')
    mkdirSync(empty)
    writeFileSync(file, markdown('Index', '[Empty](empty/)'))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Link target does not exist: empty/.'
    ])
  })

  it('accepts links to files in the current workspace', async () => {
    const workspace = createRoot()
    const root = join(workspace, '.larify')
    const source = join(workspace, 'src')
    mkdirSync(root)
    mkdirSync(source)
    writeFileSync(join(source, 'audio.ts'), 'export const audio = true')
    const file = join(root, 'index.md')
    writeFileSync(file, markdown('Index', '[Audio](../src/audio.ts)'))

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics).toEqual([])
  })

  it('reports invalid YAML frontmatter', async () => {
    const root = createRoot()
    const file = join(root, 'index.md')
    writeFileSync(file, '---\nname: [\n---')

    const result = await createContextDiagnosticsProvider(root, noDuplicate).provide(file)

    expect(result.diagnostics.map(({ message }) => message)).toContain('Invalid YAML frontmatter.')
  })
})
