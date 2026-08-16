// @vitest-environment jsdom

import { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  markdownProps: undefined as Record<string, unknown> | undefined,
  onDidChange: vi.fn(() => vi.fn()),
  readAsset: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' })),
  readFile: vi.fn(async () => '# Heading'),
  themeProps: undefined as Record<string, unknown> | undefined
}))

vi.mock('@renderer/app/theme/use-theme', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' })
}))
vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: h
}))
vi.mock('antd', () => ({
  ConfigProvider: ({
    children,
    theme
  }: {
    children: ReactNode
    theme: Record<string, unknown>
  }) => {
    h.themeProps = theme
    return children
  },
  theme: { darkAlgorithm: {}, defaultAlgorithm: {} }
}))
vi.mock('@ant-design/x-markdown/plugins/Latex', () => ({ default: () => [] }))
vi.mock('@ant-design/x-markdown', () => ({
  XMarkdown: ({
    components,
    ...props
  }: {
    components: Record<string, ComponentType<Record<string, unknown>>>
  } & Record<string, unknown>) => {
    h.markdownProps = props
    return createElement(
      'div',
      null,
      createElement('h1', { id: 'heading' }, 'Heading'),
      createElement('a', { href: 'docs/Guide%20One.md#Install' }, 'Guide'),
      createElement('a', { href: 'bad%link.md' }, 'Malformed'),
      createElement('a', { href: 'D:/workspace/absolute.md' }, 'Absolute'),
      createElement('a', { href: '\\\\server\\share\\document.md' }, 'UNC'),
      createElement('a', { href: 'https://example.com/docs' }, 'External'),
      createElement('a', { href: '#heading' }, 'Anchor'),
      createElement(components.img, { alt: 'local', src: './image.png' })
    )
  }
}))

import { MarkdownPreview } from '../../../../src/extensions/workspace/renderer/preview/markdown-preview'
import {
  workspaceMarkdownOpenExternalEvent,
  workspaceMarkdownOpenFileEvent
} from '../../../../src/extensions/workspace/renderer/preview/markdown-navigation'

describe('MarkdownPreview integration', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    h.markdownProps = undefined
    h.themeProps = undefined
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:local-image'),
      revokeObjectURL: vi.fn()
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  it('passes stripped content and the application theme to XMarkdown', async () => {
    h.readFile.mockResolvedValueOnce('---\ntitle: Hidden\n---\n# Visible')
    await act(async () => {
      root.render(
        createElement(MarkdownPreview, {
          file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
          resourceId: 7
        })
      )
      await Promise.resolve()
    })

    expect(h.markdownProps).toMatchObject({
      className: 'x-markdown-dark',
      content: '# Visible'
    })
    expect(h.markdownProps?.config).toBeDefined()
    expect(h.themeProps).toMatchObject({
      algorithm: {},
      token: {
        colorBgContainer: 'var(--workbench-content)',
        colorText: 'var(--foreground)'
      }
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('routes local links and loads local images through the workspace', async () => {
    const opened = vi.fn()
    window.addEventListener(workspaceMarkdownOpenFileEvent, opened)
    await act(async () => {
      root.render(
        createElement(MarkdownPreview, {
          file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
          resourceId: 7
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    container.querySelector<HTMLAnchorElement>('a')!.click()
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      hash: 'Install',
      path: 'D:\\workspace\\docs\\Guide One.md',
      resourceId: 7
    })
    expect(h.readAsset).toHaveBeenCalledWith(7, 'D:\\workspace\\image.png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-image')
    window.removeEventListener(workspaceMarkdownOpenFileEvent, opened)
  })

  it('does not crash on malformed percent escapes', async () => {
    await act(async () => {
      root.render(
        createElement(MarkdownPreview, {
          file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
          resourceId: 7
        })
      )
      await Promise.resolve()
    })
    expect(() => container.querySelectorAll<HTMLAnchorElement>('a')[1].click()).not.toThrow()
  })

  it('preserves absolute paths, opens web links, and scrolls to document anchors', async () => {
    const openedFile = vi.fn()
    const openedExternal = vi.fn()
    const scrollIntoView = vi.fn()
    container.addEventListener(workspaceMarkdownOpenFileEvent, openedFile)
    window.addEventListener(workspaceMarkdownOpenFileEvent, openedFile)
    window.addEventListener(workspaceMarkdownOpenExternalEvent, openedExternal)
    await act(async () => {
      root.render(
        createElement(MarkdownPreview, {
          file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
          resourceId: 7
        })
      )
      await Promise.resolve()
    })
    Object.assign(container.querySelector('h1')!, { scrollIntoView })
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')]

    links.find((link) => link.textContent === 'Absolute')!.click()
    expect((openedFile.mock.calls[0][0] as CustomEvent).detail.path).toBe(
      'D:/workspace/absolute.md'
    )

    links.find((link) => link.textContent === 'UNC')!.click()
    expect((openedFile.mock.calls[1][0] as CustomEvent).detail.path).toBe(
      '\\\\server\\share\\document.md'
    )

    links.find((link) => link.textContent === 'External')!.click()
    expect((openedExternal.mock.calls[0][0] as CustomEvent).detail).toEqual({
      resourceId: 7,
      url: 'https://example.com/docs'
    })

    links.find((link) => link.textContent === 'Anchor')!.click()
    expect(scrollIntoView).toHaveBeenCalledOnce()
    window.removeEventListener(workspaceMarkdownOpenFileEvent, openedFile)
    window.removeEventListener(workspaceMarkdownOpenExternalEvent, openedExternal)
  })

  it('replays the same target hash when its navigation revision changes', async () => {
    const props = {
      file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
      resourceId: 7
    }
    await act(async () => {
      root.render(createElement(MarkdownPreview, props))
      await Promise.resolve()
    })
    const scrollIntoView = vi.fn()
    Object.assign(container.querySelector('h1')!, { scrollIntoView })

    await act(async () => {
      root.render(
        createElement(MarkdownPreview, {
          ...props,
          target: { hash: 'heading' }
        })
      )
    })
    await act(async () => {
      root.render(
        createElement(MarkdownPreview, {
          ...props,
          target: { hash: 'heading' }
        })
      )
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
