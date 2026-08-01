import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanContextRegistry,
  registerContext,
  workspaceIndexPath
} from '../../../../src/extensions/context/main/workspace'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('context workspace', () => {
  it('uses cwd to create a stable isolated index path', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-workspace-'))
    roots.push(root)
    const indexes = join(root, 'indexes')

    expect(workspaceIndexPath(root, indexes)).toBe(workspaceIndexPath(root, indexes))
    expect(workspaceIndexPath(join(root, '.'), indexes)).toBe(workspaceIndexPath(root, indexes))
    expect(basename(workspaceIndexPath(root, indexes))).toBe('index.db')
  })

  it('isolates different workspaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-workspace-'))
    roots.push(root)

    expect(workspaceIndexPath(join(root, 'first'), root)).not.toBe(
      workspaceIndexPath(join(root, 'second'), root)
    )
  })

  it('registers each context once', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-workspace-'))
    roots.push(root)
    const indexes = join(root, 'indexes')

    registerContext(root, indexes)
    registerContext(root, indexes)

    expect(readRegistry(indexes)).toEqual([join(root, '.larify')])
  })

  it('removes missing contexts and repairs an invalid registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-workspace-'))
    roots.push(root)
    const indexes = join(root, 'indexes')
    const context = join(root, '.larify')
    mkdirSync(indexes)
    mkdirSync(context)
    writeFileSync(
      join(indexes, 'registry.json'),
      JSON.stringify({ contexts: [context, join(root, 'missing')] })
    )

    cleanContextRegistry(indexes)
    expect(readRegistry(indexes)).toEqual([context])

    writeFileSync(join(indexes, 'registry.json'), 'invalid')
    cleanContextRegistry(indexes)
    expect(readRegistry(indexes)).toEqual([])
  })

  it('ignores a missing registry without creating one', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-workspace-'))
    roots.push(root)
    const indexes = join(root, 'indexes')

    cleanContextRegistry(indexes)

    expect(() => readRegistry(indexes)).toThrow()
  })

  it('repairs non-array and mixed registry values and removes duplicates', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-workspace-'))
    roots.push(root)
    const indexes = join(root, 'indexes')
    const context = join(root, '.larify')
    mkdirSync(indexes)
    mkdirSync(context)
    const registry = join(indexes, 'registry.json')

    writeFileSync(registry, JSON.stringify({ contexts: 'invalid' }))
    cleanContextRegistry(indexes)
    expect(readRegistry(indexes)).toEqual([])

    writeFileSync(registry, JSON.stringify({ contexts: [context, context, null, 1, {}] }))
    cleanContextRegistry(indexes)
    expect(readRegistry(indexes)).toEqual([context])
  })
})

function readRegistry(indexes: string): string[] {
  return JSON.parse(readFileSync(join(indexes, 'registry.json'), 'utf8')).contexts
}
