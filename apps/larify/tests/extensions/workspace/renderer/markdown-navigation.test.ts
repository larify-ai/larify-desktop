// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  decodeUrlComponent,
  resolveWorkspacePath
} from '../../../../src/renderer/src/lib/workspace-link'
import { scrollToHash } from '../../../../src/extensions/workspace/renderer/preview/markdown-navigation'

describe('Markdown navigation', () => {
  it.each([
    ['D:\\workspace\\docs\\README.md', '..\\guide.md', 'D:\\workspace\\guide.md'],
    ['D:/workspace/docs/README.md', '../guide.md', 'D:\\workspace\\guide.md'],
    ['D:\\README.md', '..\\..\\guide.md', 'D:\\guide.md'],
    ['\\\\server\\share\\docs\\README.md', '..\\guide.md', '\\\\server\\share\\guide.md'],
    ['/workspace/docs/README.md', '../guide.md', '/workspace/guide.md'],
    ['/README.md', '../../guide.md', '/guide.md']
  ])('resolves %s with %s', (currentFile, target, expected) => {
    expect(resolveWorkspacePath(currentFile, target)).toBe(expected)
  })

  it.each([
    ['D:\\outside\\guide.md', 'D:\\outside\\guide.md'],
    ['\\\\server\\share\\guide.md', '\\\\server\\share\\guide.md'],
    ['/outside/guide.md', '/outside/guide.md']
  ])('preserves absolute target %s', (target, expected) => {
    expect(resolveWorkspacePath('D:\\workspace\\README.md', target)).toBe(expected)
  })

  it('scrolls decoded document anchors', () => {
    const root = document.createElement('div')
    root.className = 'workspace-markdown-preview'
    const heading = document.createElement('h2')
    heading.id = 'Install Guide'
    const scrollIntoView = vi.fn()
    heading.scrollIntoView = scrollIntoView
    root.append(heading)

    scrollToHash(root, decodeUrlComponent('Install%20Guide'))
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('preserves malformed URL escapes', () => {
    expect(decodeUrlComponent('bad%link')).toBe('bad%link')
  })
})
