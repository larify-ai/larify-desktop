import { describe, expect, it } from 'vitest'
import type { FileStatusResult } from 'simple-git'
import path from 'node:path'
import {
  createGitChangeTree,
  createPathChangeTree,
  isGitChange
} from '../../../../src/extensions/workspace/renderer/changes/git-change-tree'

const status = (path: string, index: string, working_dir: string): FileStatusResult =>
  ({ path, index, working_dir }) as FileStatusResult

describe('createGitChangeTree', () => {
  it.each([
    ['  ', false],
    ['!!', false],
    ['??', true],
    ['M ', true],
    [' M', true],
    ['A ', true],
    ['R ', true],
    ['UU', true]
  ])('classifies Git status %s', (pair, expected) => {
    expect(isGitChange(status('file.ts', pair[0], pair[1]))).toBe(expected)
  })

  it('keeps only changed files and their parent directories', () => {
    const filesystemRoot = path.parse(process.cwd()).root
    const workspace = path.join(filesystemRoot, 'workspace')
    const source = path.join(workspace, 'src')
    const [root] = createGitChangeTree(workspace, [
      status(path.join(source, 'changed.ts'), ' ', 'M'),
      status(path.join(source, 'ignored.ts'), '!', '!'),
      status(path.join(filesystemRoot, 'outside', 'file.ts'), ' ', 'M')
    ])

    expect(root.children).toEqual([
      {
        children: [
          {
            isLeaf: true,
            key: path.join(source, 'changed.ts'),
            title: 'changed.ts'
          }
        ],
        key: source,
        title: 'src'
      }
    ])
  })

  it('returns the root when there are no changes', () => {
    const workspace = path.join(path.parse(process.cwd()).root, 'workspace')

    expect(
      createGitChangeTree(workspace, [status(path.join(workspace, 'ignored'), '!', '!')])
    ).toEqual([
      {
        children: [],
        key: workspace,
        title: 'workspace'
      }
    ])
  })

  it('preserves filesystem roots', () => {
    const filesystemRoot = path.parse(process.cwd()).root
    const file = path.join(filesystemRoot, 'file.ts')

    expect(createPathChangeTree(filesystemRoot, [file])).toEqual([
      {
        children: [{ isLeaf: true, key: file, title: 'file.ts' }],
        key: filesystemRoot,
        title: filesystemRoot
      }
    ])
  })

  it('rejects parent traversal', () => {
    const workspace = path.join(path.parse(process.cwd()).root, 'workspace')
    const [root] = createPathChangeTree(workspace, [path.join('src', 'file.ts'), '..'])

    expect(root.key).toBe(workspace)
    expect(root.children).toHaveLength(1)
    expect(root.children?.[0].key).toBe(path.join(workspace, 'src'))
  })

  it('deduplicates normalized paths and rejects similarly prefixed siblings', () => {
    const filesystemRoot = path.parse(process.cwd()).root
    const workspace = path.join(filesystemRoot, 'workspace')
    const file = path.join(workspace, 'src', 'file.ts')
    const [root] = createPathChangeTree(workspace, [
      file,
      path.join(workspace, 'src', '.', 'file.ts'),
      path.join(filesystemRoot, 'workspace-other', 'file.ts')
    ])

    expect(root.children).toEqual([
      {
        children: [{ isLeaf: true, key: file, title: 'file.ts' }],
        key: path.join(workspace, 'src'),
        title: 'src'
      }
    ])
  })

  it('preserves Unicode, spaces, and punctuation in path segments', () => {
    const workspace = path.join(path.parse(process.cwd()).root, '工作区')
    const [root] = createPathChangeTree(workspace, [
      path.join('文档', '设计 草稿.md'),
      path.join('源代码', '组件（新版）', '按钮.tsx')
    ])

    expect(root).toEqual({
      children: [
        {
          children: [
            {
              isLeaf: true,
              key: path.join(workspace, '文档', '设计 草稿.md'),
              title: '设计 草稿.md'
            }
          ],
          key: path.join(workspace, '文档'),
          title: '文档'
        },
        {
          children: [
            {
              children: [
                {
                  isLeaf: true,
                  key: path.join(workspace, '源代码', '组件（新版）', '按钮.tsx'),
                  title: '按钮.tsx'
                }
              ],
              key: path.join(workspace, '源代码', '组件（新版）'),
              title: '组件（新版）'
            }
          ],
          key: path.join(workspace, '源代码'),
          title: '源代码'
        }
      ],
      key: workspace,
      title: '工作区'
    })
  })
})
