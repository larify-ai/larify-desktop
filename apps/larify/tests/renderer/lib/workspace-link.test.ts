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
})
