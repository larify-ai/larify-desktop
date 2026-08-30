// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMessageLink,
  MessageLink
} from '../../../../src/renderer/src/components/ai-elements/message-link'

describe('MessageLink', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows a file link without an icon, omits the native href, and invokes onOpenLink', async () => {
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(
        createElement(MessageLink, { href: 'src/main/index.ts', onOpenLink }, '打开 index.ts')
      )
    })

    expect(container.querySelector('svg')).toBeNull()
    const button = container.querySelector('button')
    expect(container.querySelector('a')).toBeNull()
    expect(button?.type).toBe('button')
    expect(button?.classList).toContain('text-blue-500')
    expect(button?.classList).toContain('cursor-pointer')
    expect(button?.classList).toContain('no-underline')

    await act(async () => {
      container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'file',
      target: 'src/main/index.ts'
    })
  })

  it('shows a url label without an icon', async () => {
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(createElement(MessageLink, { href: 'https://example.com', onOpenLink }, '文档'))
    })

    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('文档')

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => container.querySelector('a')!.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'url',
      target: 'https://example.com'
    })
  })

  it('routes a file URL only through Larify and never through the renderer fallback', async () => {
    const onClick = vi.fn()
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          MessageLink,
          {
            href: 'file:///D:/Workspace/project/file.ts',
            onClick,
            onOpenLink
          },
          'file.ts'
        )
      )
    })

    const button = container.querySelector('button')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      button.dispatchEvent(event)
    })

    expect(container.querySelector('a')).toBeNull()
    expect(button.type).toBe('button')
    expect(event.defaultPrevented).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'file',
      target: 'file:///D:/Workspace/project/file.ts'
    })
  })

  it('recovers a sanitized file href from the markdown node', async () => {
    const onClick = vi.fn()
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          MessageLink,
          {
            node: { properties: { href: 'file:///D:/Workspace/project/file.ts' } },
            onClick,
            onOpenLink
          },
          'file.ts'
        )
      )
    })

    const button = container.querySelector('button')!
    await act(async () => button.click())

    expect(container.querySelector('a')).toBeNull()
    expect(onClick).not.toHaveBeenCalled()
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'file',
      target: 'file:///D:/Workspace/project/file.ts'
    })
  })

  it('renders a Markdown-encoded Windows path as a file button', async () => {
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          MessageLink,
          { href: 'D:%5CWorkspace%5Cproject%5Cpackage.json', onOpenLink },
          'package.json'
        )
      )
    })

    const button = container.querySelector('button')!
    await act(async () => button.click())

    expect(container.querySelector('a')).toBeNull()
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'file',
      target: 'D:%5CWorkspace%5Cproject%5Cpackage.json'
    })
  })

  it('does not call the renderer fallback for a file link', async () => {
    const onClick = vi.fn()
    await act(async () => {
      root.render(createElement(MessageLink, { href: '/abs/path.txt', onClick }, '文件'))
    })

    const button = container.querySelector('button')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(container.querySelector('a')).toBeNull()
    await act(async () => {
      button.dispatchEvent(event)
    })
    expect(onClick).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not route unsupported url schemes through the workspace handler', async () => {
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(
        createElement(MessageLink, { href: 'mailto:user@example.com', onOpenLink }, '邮件')
      )
    })

    const anchor = container.querySelector('a')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      anchor.dispatchEvent(event)
    })

    expect(anchor.hasAttribute('href')).toBe(false)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('does not invoke the renderer fallback for an unsupported link', async () => {
    const onClick = vi.fn()
    await act(async () => {
      root.render(createElement(MessageLink, { href: 'mailto:user@example.com', onClick }, '邮件'))
    })

    await act(async () => container.querySelector('a')!.click())
    expect(onClick).not.toHaveBeenCalled()
  })

  it('removes navigation for unsafe schemes', async () => {
    const onOpenLink = vi.fn()
    await act(async () => {
      root.render(createElement(MessageLink, { href: 'javascript:alert(1)', onOpenLink }, '危险'))
    })
    const anchor = container.querySelector('a')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    await act(async () => {
      anchor.dispatchEvent(event)
    })

    expect(anchor.hasAttribute('href')).toBe(false)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('removes unsupported schemes even without a handler', async () => {
    await act(async () => {
      root.render(createElement(MessageLink, { href: 'mailto:user@example.com' }, '邮件'))
    })
    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  it('removes an empty href', async () => {
    await act(async () => {
      root.render(createElement(MessageLink, { href: '' }, '空链接'))
    })
    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  it('does not show an external icon for an anchor', async () => {
    const onClick = vi.fn()
    await act(async () => {
      root.render(createElement(MessageLink, { href: '#section', onClick }, '章节'))
    })

    const anchor = container.querySelector('a')!
    expect(anchor.getAttribute('href')).toBe('#section')
    expect(container.querySelector('svg')).toBeNull()

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => anchor.dispatchEvent(event))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('prevents the default hash navigation for an anchor without an onClick handler', async () => {
    await act(async () => {
      root.render(createElement(MessageLink, { href: '#missing' }, '章节'))
    })

    const anchor = container.querySelector('a')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => anchor.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('createMessageLink', () => {
  it('produces a component that routes clicks through the bound handler', async () => {
    const onOpenLink = vi.fn()
    const Link = createMessageLink(onOpenLink)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    await act(async () => {
      root.render(createElement(Link, { href: 'docs/readme.md' }, 'readme'))
    })

    await act(async () => {
      container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'file',
      target: 'docs/readme.md'
    })

    await act(async () => root.unmount())
    container.remove()
  })
})
