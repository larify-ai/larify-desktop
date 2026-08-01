import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readContextDocument } from '../../../../src/extensions/context/main/document'

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'larify-context-document-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('context document', () => {
  it('reads metadata, body, URI, and source hash', () => {
    const file = join(createRoot(), 'subject.md')
    const source =
      '---\nname: " Subject "\ndescription: " Description "\ntags: [test]\n---\n\n# Subject\n\nBody\n'
    writeFileSync(file, source)

    expect(readContextDocument(file)).toEqual({
      node: {
        name: 'Subject',
        description: 'Description',
        uri: pathToFileURL(resolve(file)).href
      },
      content: '\n# Subject\n\nBody\n',
      hash: createHash('sha256').update(source).digest('hex')
    })
  })

  it.each([
    ['missing name', '---\ndescription: Description\n---'],
    ['missing description', '---\nname: Subject\n---'],
    ['empty name', '---\nname: " "\ndescription: Description\n---'],
    ['non-string description', '---\nname: Subject\ndescription: 42\n---'],
    ['invalid YAML', '---\nname: [\n---']
  ])('rejects %s', (_case, source) => {
    const file = join(createRoot(), 'subject.md')
    writeFileSync(file, source)

    expect(readContextDocument(file)).toBeUndefined()
  })

  it('returns undefined when the file cannot be read', () => {
    const file = join(createRoot(), 'missing.md')

    expect(readContextDocument(file)).toBeUndefined()
  })

  it('changes the hash whenever the source changes', () => {
    const file = join(createRoot(), 'subject.md')
    writeFileSync(file, '---\nname: Subject\ndescription: Description\n---\nFirst')
    const first = readContextDocument(file)

    writeFileSync(file, '---\nname: Subject\ndescription: Description\n---\nSecond')
    const second = readContextDocument(file)

    expect(first?.hash).not.toBe(second?.hash)
    expect(second?.content).toBe('Second')
  })
})
