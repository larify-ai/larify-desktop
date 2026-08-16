import { describe, expect, it } from 'vitest'
import type { FileStatusResult } from 'simple-git'
import { createGitChangeTree } from '../../../../src/extensions/workspace/renderer/changes/git-change-tree'

const status = (path: string, index: string, working_dir: string): FileStatusResult =>
  ({ path, index, working_dir }) as FileStatusResult

describe('createGitChangeTree', () => {
  it('keeps only changed files and their parent directories', () => {
    const [root] = createGitChangeTree('D:\\workspace', [
      status('D:\\workspace\\src\\changed.ts', ' ', 'M'),
      status('D:\\workspace\\src\\ignored.ts', '!', '!'),
      status('D:\\outside\\file.ts', ' ', 'M')
    ])

    expect(root.children).toEqual([
      {
        children: [
          {
            isLeaf: true,
            key: 'D:\\workspace\\src\\changed.ts',
            title: 'changed.ts'
          }
        ],
        key: 'D:\\workspace\\src',
        title: 'src'
      }
    ])
  })

  it('returns the root when there are no changes', () => {
    expect(createGitChangeTree('/workspace', [status('/workspace/ignored', '!', '!')])).toEqual([
      {
        children: [],
        key: '/workspace',
        title: 'workspace'
      }
    ])
  })
})
