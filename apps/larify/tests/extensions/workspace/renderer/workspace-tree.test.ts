import { describe, expect, it } from 'vitest'
import type { TreeEntry } from '../../../../src/extensions/workspace/renderer/workspace-tree'
import { findTreeEntryPath } from '../../../../src/extensions/workspace/renderer/workspace-tree-path'

describe('findTreeEntryPath', () => {
  const entries: TreeEntry[] = [
    {
      kind: 'directory',
      name: 'workspace',
      path: 'D:\\Workspace',
      children: [
        {
          kind: 'file',
          name: 'index.ts',
          path: 'D:\\Workspace\\index.ts'
        }
      ]
    }
  ]

  it('matches Windows paths without drive-letter case sensitivity', () => {
    expect(findTreeEntryPath(entries, 'd:\\Workspace\\index.ts')).toBe('D:\\Workspace\\index.ts')
  })

  it('keeps non-Windows paths case-sensitive', () => {
    expect(findTreeEntryPath(entries, '/Workspace/index.ts')).toBeUndefined()
  })
})
