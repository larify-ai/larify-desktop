import { describe, expect, it } from 'vitest'
import {
  type TreeEntry
} from '../../../../src/extensions/workspace/renderer/workspace-tree'
import { initialOpenState } from '../../../../src/extensions/workspace/renderer/workspace-tree-state'

const directory = (
  path: string,
  children: TreeEntry[],
  root = false
): TreeEntry => ({
  children,
  kind: 'directory',
  loaded: true,
  name: path.split('/').at(-1) ?? path,
  path,
  root
})

describe('initialOpenState', () => {
  it('opens the root and small directories in the changes view', () => {
    const entries = [
      directory('/workspace', [directory('/workspace/src', [])], true)
    ]

    expect(initialOpenState(entries, true)).toEqual({
      '/workspace': true,
      '/workspace/src': true
    })
  })

  it('keeps large directories collapsed', () => {
    const children = Array.from({ length: 51 }, (_, index) => ({
      kind: 'file' as const,
      loaded: true,
      name: `${index}.ts`,
      path: `/workspace/generated/${index}.ts`
    }))
    const entries = [
      directory('/workspace', [directory('/workspace/generated', children)], true)
    ]

    expect(initialOpenState(entries, true)).toEqual({
      '/workspace': true,
      '/workspace/generated': false
    })
  })

  it('only opens the root in the global view', () => {
    const entries = [
      directory('/workspace', [directory('/workspace/src', [])], true)
    ]

    expect(initialOpenState(entries, false)).toEqual({
      '/workspace': true,
      '/workspace/src': false
    })
  })
})
