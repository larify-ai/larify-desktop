// @vitest-environment jsdom

import type { MouseEvent as ReactMouseEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  decodeUrlComponent,
  handleMarkdownLinkClick,
  resolveWorkspacePath,
  workspaceMarkdownOpenExternalEvent,
  workspaceMarkdownOpenFileEvent
} from '../../../../src/extensions/workspace/renderer/preview/markdown-navigation'

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

  it.each([
    ['//example.com/docs', 'https://example.com/docs'],
    ['https://example.com/docs', 'https://example.com/docs'],
    ['https:example.com/docs', 'https:example.com/docs']
  ])('opens external link %s as %s', (href, expected) => {
    const opened = vi.fn()
    window.addEventListener(workspaceMarkdownOpenExternalEvent, opened)
    click(href)

    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      resourceId: 7,
      url: expected
    })
    window.removeEventListener(workspaceMarkdownOpenExternalEvent, opened)
  })

  it('scrolls decoded document anchors without opening another file', () => {
    const root = document.createElement('div')
    root.className = 'workspace-markdown-preview'
    const anchor = document.createElement('a')
    anchor.setAttribute('href', '#Install%20Guide')
    const heading = document.createElement('h2')
    heading.id = 'Install Guide'
    const scrollIntoView = vi.fn()
    heading.scrollIntoView = scrollIntoView
    root.append(anchor, heading)

    clickAnchor(anchor)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('preserves malformed URL escapes', () => {
    expect(decodeUrlComponent('bad%link')).toBe('bad%link')
  })

  it.each(['mailto:user@example.com', 'tel:+123456', 'javascript:alert(1)'])(
    'does not treat unsupported scheme %s as a local file',
    (href) => {
      const openedFile = vi.fn()
      const openedExternal = vi.fn()
      window.addEventListener(workspaceMarkdownOpenFileEvent, openedFile)
      window.addEventListener(workspaceMarkdownOpenExternalEvent, openedExternal)

      const preventDefault = click(href)

      expect(preventDefault).toHaveBeenCalledOnce()
      expect(openedFile).not.toHaveBeenCalled()
      expect(openedExternal).not.toHaveBeenCalled()
      window.removeEventListener(workspaceMarkdownOpenFileEvent, openedFile)
      window.removeEventListener(workspaceMarkdownOpenExternalEvent, openedExternal)
    }
  )

  it('removes query parameters from local file paths while preserving the hash', () => {
    const opened = vi.fn()
    window.addEventListener(workspaceMarkdownOpenFileEvent, opened)
    click('../guide.md?raw=1#Install%20Guide')

    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      hash: 'Install Guide',
      path: 'D:\\workspace\\guide.md',
      resourceId: 7
    })
    window.removeEventListener(workspaceMarkdownOpenFileEvent, opened)
  })

  it('keeps query-only links on the current document', () => {
    const opened = vi.fn()
    window.addEventListener(workspaceMarkdownOpenFileEvent, opened)
    click('?raw=1#Install')

    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      hash: 'Install',
      path: 'D:\\workspace\\docs\\README.md',
      resourceId: 7
    })
    window.removeEventListener(workspaceMarkdownOpenFileEvent, opened)
  })

  it('ignores clicks whose target is not an element', () => {
    expect(() =>
      handleMarkdownLinkClick(
        { target: document.createTextNode('text') } as unknown as ReactMouseEvent<HTMLElement>,
        'D:\\workspace\\docs\\README.md',
        7
      )
    ).not.toThrow()
  })
})

function click(href: string): ReturnType<typeof vi.fn> {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.setAttribute('href', href)
  return clickAnchor(anchor)
}

function clickAnchor(anchor: HTMLAnchorElement): ReturnType<typeof vi.fn> {
  const preventDefault = vi.fn()
  handleMarkdownLinkClick(
    {
      preventDefault,
      target: anchor
    } as unknown as ReactMouseEvent<HTMLElement>,
    'D:\\workspace\\docs\\README.md',
    7
  )
  return preventDefault
}
