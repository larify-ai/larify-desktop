// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  requestWorkspaceNavigation,
  takeWorkspaceNavigation,
  workspaceRootForFile
} from '../../../../src/extensions/workspace/renderer/workspace-navigation'

describe('workspace navigation', () => {
  it('stores, dispatches, and consumes a pending navigation once', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const request = { path: '/workspace/a.ts', hash: 'L2', resourceId: 7 }

    requestWorkspaceNavigation(request)

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'larify:workspace-navigation' })
    )
    expect(takeWorkspaceNavigation(7)).toEqual(request)
    expect(takeWorkspaceNavigation(7)).toBeNull()
  })

  it('keeps only the latest request for each resource', () => {
    const first = { path: '/workspace/first.ts', resourceId: 7 }
    const latest = { path: '/workspace/latest.ts', resourceId: 7 }
    const other = { path: '/workspace/other.ts', resourceId: 8 }

    requestWorkspaceNavigation(first)
    requestWorkspaceNavigation(other)
    requestWorkspaceNavigation(latest)

    expect(takeWorkspaceNavigation(7)).toEqual(latest)
    expect(takeWorkspaceNavigation(8)).toEqual(other)
  })

  it('preserves a directory request while dispatching and consuming it', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const request = {
      kind: 'directory' as const,
      path: 'D:\\Workspace\\folder',
      resourceId: 9
    }

    requestWorkspaceNavigation(request)

    const event = dispatch.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual(request)
    expect(takeWorkspaceNavigation(9)).toEqual(request)
    expect(takeWorkspaceNavigation(9)).toBeNull()
  })

  it('computes the root inside the base for in-tree files', () => {
    expect(workspaceRootForFile('D:\\Project', 'D:\\Project\\src\\a.md')).toBe('D:\\Project')
  })

  it('falls back to the target directory for out-of-tree files', () => {
    expect(workspaceRootForFile('D:\\Project', 'D:\\Other\\notes\\a.md')).toBe(
      'D:\\Other\\notes'
    )
  })

  it('keeps the workspace root for default-space absolute files', () => {
    expect(workspaceRootForFile('', 'C:\\Users\\me\\notes\\a.md')).toBe('C:\\Users\\me\\notes')
  })

  it('uses the memory root for files under ~/.larify/memory', () => {
    expect(
      workspaceRootForFile(
        'C:\\Users\\hylnb\\.larify\\workspace',
        'C:\\Users\\hylnb\\.larify\\memory\\larify-desktop\\index.md'
      )
    ).toBe('C:\\Users\\hylnb\\.larify\\memory')
  })

  it('uses the tasks root for files under ~/.larify/tasks', () => {
    expect(
      workspaceRootForFile(
        'C:\\Users\\hylnb\\.larify\\workspace',
        'C:\\Users\\hylnb\\.larify\\tasks\\some-task\\task.md'
      )
    ).toBe('C:\\Users\\hylnb\\.larify\\tasks')
  })

  it('matches anchor roots case-insensitively on Windows', () => {
    expect(
      workspaceRootForFile(
        'C:\\Users\\hylnb\\.larify\\workspace',
        'C:\\Users\\HYLNB\\.larify\\MEMORY\\larify-desktop\\index.md'
      )
    ).toBe('C:\\Users\\HYLNB\\.larify\\MEMORY')
  })

  it('matches anchor roots on POSIX', () => {
    expect(
      workspaceRootForFile('/Users/me/.larify/workspace', '/Users/me/.larify/memory/a/b.md')
    ).toBe('/Users/me/.larify/memory')
    expect(
      workspaceRootForFile('/Users/me/.larify/workspace', '/Users/me/.larify/tasks/t/t.md')
    ).toBe('/Users/me/.larify/tasks')
    expect(
      workspaceRootForFile('/Users/me/.larify/workspace', '/Users/me/.larify/workspace/x.md')
    ).toBe('/Users/me/.larify/workspace')
  })

  it('matches anchor roots on UNC paths', () => {
    expect(
      workspaceRootForFile('\\\\server\\share', '\\\\server\\share\\.larify\\memory\\a.md')
    ).toBe('\\\\server\\share\\.larify\\memory')
  })

  it('requires a literal dot segment before memory/tasks', () => {
    expect(workspaceRootForFile('', 'C:\\Users\\mlarify\\memory\\a.md')).toBe(
      'C:\\Users\\mlarify\\memory'
    )
    expect(workspaceRootForFile('', 'C:\\Users\\hylnb\\larify\\memory\\a.md')).toBe(
      'C:\\Users\\hylnb\\larify\\memory'
    )
  })

  it('normalizes an anchor root extracted from a dotted path', () => {
    expect(
      workspaceRootForFile('D:\\Project', 'D:\\foo\\..\\.larify\\memory\\a.md')
    ).toBe('D:\\.larify\\memory')
  })

  it('treats the anchor root itself as inside', () => {
    expect(
      workspaceRootForFile('C:\\Users\\hylnb\\.larify\\workspace', 'C:\\Users\\hylnb\\.larify\\memory')
    ).toBe('C:\\Users\\hylnb\\.larify\\memory')
  })

  it('does not anchor sibling names under ~/.larify', () => {
    expect(
      workspaceRootForFile('', 'C:\\Users\\hylnb\\.larify\\my-memory\\a.md')
    ).toBe('C:\\Users\\hylnb\\.larify\\my-memory')
    expect(
      workspaceRootForFile('', 'C:\\Users\\hylnb\\.larify\\memory-backup\\a.md')
    ).toBe('C:\\Users\\hylnb\\.larify\\memory-backup')
    expect(
      workspaceRootForFile('', 'C:\\Users\\hylnb\\.larify\\workspace\\doc.md')
    ).toBe('C:\\Users\\hylnb\\.larify\\workspace')
  })

  it('ignores the anchor for relative targets', () => {
    expect(workspaceRootForFile('D:\\Project', 'src\\a.md')).toBe('D:\\Project')
    expect(workspaceRootForFile('D:\\Project', '..\\.larify\\memory\\a.md')).toBe(
      'D:\\.larify\\memory'
    )
  })
})
