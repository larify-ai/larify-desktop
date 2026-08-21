import { describe, expect, it } from 'vitest'
import {
  parseWorkspaceLink,
  resolveWorkspaceLink
} from '../../../src/renderer/src/lib/workspace-link'

describe('workspace link', () => {
  it('leaves an invalid file URL to the platform instead of treating it as a path', () => {
    expect(parseWorkspaceLink('file://[')).toBeNull()
  })

  it.each(['mailto:user@example.com', 'javascript:alert(1)', 'data:text/html,<h1>x</h1>'])(
    'ignores unsupported scheme %s',
    (href) => expect(parseWorkspaceLink(href)).toBeNull()
  )

  it('recognizes Windows paths whose separators were encoded by Markdown', () => {
    const href = 'D:%5CWorkspace%5Clarify-desktop%5Cpackage.json'

    expect(parseWorkspaceLink(href)).toEqual({
      kind: 'file',
      target: 'D:\\Workspace\\larify-desktop\\package.json'
    })
    expect(resolveWorkspaceLink('D:\\Workspace\\larify-desktop', href)).toEqual({
      path: 'D:\\Workspace\\larify-desktop\\package.json'
    })
  })

  it('resolves a Windows absolute path without a workspace base', () => {
    expect(resolveWorkspaceLink('', 'C:\\Users\\test\\notes\\说明.md')).toEqual({
      path: 'C:\\Users\\test\\notes\\说明.md'
    })
  })

  it('resolves a Windows file URL without a workspace base', () => {
    expect(
      resolveWorkspaceLink('', 'file:///C:/Users/test/notes/%E8%AF%B4%E6%98%8E.md#L10')
    ).toEqual({
      path: 'C:\\Users\\test\\notes\\说明.md',
      hash: 'L10'
    })
  })

  it('resolves an encoded Windows file URL without a workspace base', () => {
    expect(resolveWorkspaceLink('', 'file:///C:%5CUsers%5Ctest%5Cnotes.txt')).toEqual({
      path: 'C:\\Users\\test\\notes.txt'
    })
  })

  it('keeps POSIX file URLs POSIX without a workspace base', () => {
    expect(resolveWorkspaceLink('', 'file:///tmp/notes.md')).toEqual({ path: '/tmp/notes.md' })
  })

  it('preserves additional hash characters inside a fragment', () => {
    expect(resolveWorkspaceLink('', 'file:///C:/notes.md#section#details')).toEqual({
      path: 'C:\\notes.md',
      hash: 'section#details'
    })
  })

  it('resolves a file URL host as a UNC path without a workspace base', () => {
    expect(resolveWorkspaceLink('', 'file://server/share/folder/notes.md')).toEqual({
      path: '\\\\server\\share\\folder\\notes.md'
    })
  })

  it('uses an absolute target path flavor instead of the workspace flavor', () => {
    expect(resolveWorkspaceLink('/workspace', 'C:\\Users\\test\\notes.md')).toEqual({
      path: 'C:\\Users\\test\\notes.md'
    })
    expect(resolveWorkspaceLink('C:\\Workspace', '/tmp/notes.md')).toEqual({
      path: '/tmp/notes.md'
    })
  })
})
