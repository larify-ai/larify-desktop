import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FileStatusResult } from 'simple-git'
import {
  createGitStatusColors,
  gitDecorationColorId
} from '../../../../src/extensions/workspace/renderer/changes/git-status'

const status = (
  file: string,
  index: FileStatusResult['index'],
  working_dir: FileStatusResult['working_dir']
): FileStatusResult => ({ path: file, index, working_dir })

describe('createGitStatusColors', () => {
  const root = path.resolve('workspace')
  const file = path.join(root, 'src', 'file.ts')

  it('decorates a file and all of its parent directories', () => {
    const colors = createGitStatusColors(root, [status(file, ' ', 'M')])

    expect(colors.get(file)).toContain('modifiedResourceForeground')
    expect(colors.get(path.dirname(file))).toContain('modifiedResourceForeground')
    expect(colors.get(root)).toContain('modifiedResourceForeground')
  })

  it('uses the first decorated explorer child for parent directories', () => {
    const colors = createGitStatusColors(root, [
      status(path.join(root, 'renderer', 'modified.ts'), ' ', 'M'),
      status(path.join(root, 'main', 'git', 'new.ts'), '?', '?'),
      status(path.join(root, 'main', 'ipc.ts'), ' ', 'M')
    ])

    expect(colors.get(path.join(root, 'main'))).toContain('untrackedResourceForeground')
    expect(colors.get(root)).toContain('untrackedResourceForeground')
    expect(colors.get(path.join(root, 'renderer', 'modified.ts'))).toContain(
      'modifiedResourceForeground'
    )
  })

  it('treats both-added as a conflict', () => {
    const colors = createGitStatusColors(root, [status(file, 'A', 'A')])

    expect(colors.get(file)).toContain('conflictingResourceForeground')
  })

  it('uses green for untracked files', () => {
    const colors = createGitStatusColors(root, [status(file, '?', '?')])

    expect(colors.get(file)).toContain('untrackedResourceForeground')
  })

  it('uses the dedicated theme colors for staged and renamed files', () => {
    expect(createGitStatusColors(root, [status(file, 'M', ' ')]).get(file)).toContain(
      'stageModifiedResourceForeground'
    )
    expect(createGitStatusColors(root, [status(file, 'R', ' ')]).get(file)).toContain(
      'renamedResourceForeground'
    )
  })

  it.each([
    ['AA', 'A', 'A'],
    ['DD', 'D', 'D'],
    ['AU', 'A', 'U'],
    ['UA', 'U', 'A'],
    ['DU', 'D', 'U'],
    ['UD', 'U', 'D'],
    ['UU', 'U', 'U']
  ] as const)('maps the %s merge state to the conflict theme color', (_, index, worktree) => {
    expect(createGitStatusColors(root, [status(file, index, worktree)]).get(file)).toContain(
      'conflictingResourceForeground'
    )
  })

  it.each([
    ['unstaged deletion', ' ', 'D', 'deletedResourceForeground'],
    ['staged deletion', 'D', ' ', 'stageDeletedResourceForeground'],
    ['unstaged modification', ' ', 'M', 'modifiedResourceForeground'],
    ['unstaged type change', ' ', 'T', 'modifiedResourceForeground'],
    ['staged modification', 'M', ' ', 'stageModifiedResourceForeground'],
    ['staged type change', 'T', ' ', 'stageModifiedResourceForeground'],
    ['renamed file', 'R', ' ', 'renamedResourceForeground'],
    ['copied file', 'C', ' ', 'renamedResourceForeground'],
    ['staged addition', 'A', ' ', 'addedResourceForeground'],
    ['untracked file', '?', '?', 'untrackedResourceForeground'],
    ['ignored file', '!', '!', 'ignoredResourceForeground']
  ] as const)('maps %s to its VS Code theme color', (_, index, worktree, expected) => {
    const fileStatus = status(file, index, worktree)
    expect(createGitStatusColors(root, [fileStatus]).get(file)).toContain(expected)
    expect(gitDecorationColorId(fileStatus)).toBe(`gitDecoration.${expected}`)
  })

  it('does not decorate paths outside the workspace', () => {
    const outside = path.resolve('workspace-other', 'file.ts')

    expect(createGitStatusColors(root, [status(outside, ' ', 'M')])).toEqual(new Map())
  })

  it('does not propagate ignored colors to parent directories', () => {
    const ignored = path.join(root, 'packages', 'plugin-host', 'node_modules')
    const colors = createGitStatusColors(root, [status(ignored, '!', '!')])

    expect(colors.get(ignored)).toContain('ignoredResourceForeground')
    expect(colors.has(path.join(root, 'packages', 'plugin-host'))).toBe(false)
    expect(colors.has(path.join(root, 'packages'))).toBe(false)
    expect(colors.has(root)).toBe(false)
  })

  it('supports POSIX workspace paths', () => {
    const colors = createGitStatusColors('/workspace', [status('/workspace/src/file.ts', ' ', 'M')])

    expect(colors.get('/workspace/src/file.ts')).toContain('modifiedResourceForeground')
    expect(colors.get('/workspace/src')).toContain('modifiedResourceForeground')
    expect(colors.get('/workspace')).toContain('modifiedResourceForeground')
  })

  it('does not decorate clean or unknown states', () => {
    expect(createGitStatusColors(root, [status(file, ' ', ' ')])).toEqual(new Map())
  })

  it('returns no decorations without a workspace root', () => {
    expect(createGitStatusColors('', [status(file, ' ', 'M')])).toEqual(new Map())
  })
})
