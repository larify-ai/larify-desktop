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
    const A = components.a as ComponentType<Record<string, unknown>>
    return createElement(
      'div',
      null,
      createElement('h1', { id: 'heading' }, 'Heading'),
      createElement(A, { href: 'docs/Guide%20One.md#Install', key: 'guide' }, 'Guide'),
      createElement(A, { href: 'bad%link.md', key: 'bad' }, 'Malformed'),
      createElement(A, { href: 'D:/workspace/absolute.md', key: 'abs' }, 'Absolute'),
      createElement(A, { href: '\\\\server\\share\\document.md', key: 'unc' }, 'UNC'),
      createElement(A, { href: 'https://example.com/docs', key: 'ext' }, 'External'),
      createElement(A, { href: '#heading', key: 'anchor' }, 'Anchor'),
      createElement(components.img, { alt: 'local', src: './image.png', key: 'img' })
    )
  }
}))

import { MarkdownPreview } from '../../../../src/extensions/workspace/renderer/preview/markdown-preview'

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
    const invoke = vi.fn(async (name: string, ...args: unknown[]) => {
      if (name === 'workspace:path-kind') return 'file'
      if (name === 'browser:openUrl') return 99
      return undefined
    })
    vi.stubGlobal('bridge', { invoke })
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
    // XMarkdown 默认 DOMPurify 净化会剥离盘符/file 协议 href，导致本地文件链接不可点。
    // 组件必须通过 dompurifyConfig 放行这些协议，同时仍禁止 javascript:/vbscript: 等危险协议。
    const dompurifyConfig = h.markdownProps?.dompurifyConfig as {
      ALLOWED_URI_REGEXP: RegExp
    }
    expect(dompurifyConfig).toBeDefined()
    const allow = dompurifyConfig.ALLOWED_URI_REGEXP
    expect(allow.test('D:/workspace/absolute.md')).toBe(true)
    expect(allow.test('D:/Workspace/a.txt')).toBe(true)
    expect(allow.test('file:///D:/Workspace/b.txt')).toBe(true)
    expect(allow.test('https://example.com/docs')).toBe(true)
    expect(allow.test('docs/Guide%20One.md#Install')).toBe(true)
    expect(allow.test('#heading')).toBe(true)
    expect(allow.test('javascript:alert(1)')).toBe(false)
    expect(allow.test('vbscript:msgbox(1)')).toBe(false)
    expect(h.themeProps).toMatchObject({
      algorithm: {},
      token: {
        colorBgContainer: 'var(--workbench-content)',
        colorText: 'var(--foreground)'
      }
    })
  })

  it('defers reading an inactive preview until it becomes active', async () => {
    const props = {
      file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
      resourceId: 7
    }
    await act(async () => {
      root.render(createElement(MarkdownPreview, { ...props, active: false }))
      await Promise.resolve()
    })
    expect(h.readFile).not.toHaveBeenCalled()

    await act(async () => {
      root.render(createElement(MarkdownPreview, { ...props, active: true }))
      await Promise.resolve()
    })
    expect(h.readFile).toHaveBeenCalledOnce()
    expect(h.readFile).toHaveBeenCalledWith(7, 'D:\\workspace\\README.md')
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('routes local links and loads local images through the workspace', async () => {
    const opened = vi.fn()
    window.addEventListener('larify:workbench-open', opened)
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

    container.querySelector('button, a')!.click()
    await act(async () => {
      await Promise.resolve()
    })
    expect(opened).toHaveBeenCalled()
    const detail = (opened.mock.calls[0][0] as CustomEvent).detail
    expect(detail.rendererId).toBe('workspace')
    expect(detail.options.root).toBe('D:\\workspace')
    expect(typeof detail.onOpen).toBe('function')
    expect(h.readAsset).toHaveBeenCalledWith(7, 'D:\\workspace\\image.png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-image')
    window.removeEventListener('larify:workbench-open', opened)
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
    const allClickable = [
      ...container.querySelectorAll<HTMLElement>('button.larify-message-link, a.larify-message-link')
    ]
    const badLink = allClickable.find((el) => el.textContent === 'Malformed')
    expect(badLink).not.toBeUndefined()
    expect(() => badLink!.click()).not.toThrow()
  })

  it('preserves absolute paths, opens web links, and scrolls to document anchors', async () => {
    const openedWorkbench = vi.fn()
    const scrollIntoView = vi.fn()
    window.addEventListener('larify:workbench-open', openedWorkbench)
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
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button.larify-message-link')]
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a.larify-message-link')]
    const clickables = [...buttons, ...links]
    const findEl = (text: string): Element =>
      clickables.find((el) => el.textContent === text) ?? links.find((el) => el.textContent === text)!

    await act(async () => {
      ; (findEl('Absolute') as HTMLElement).click()
    })
    expect(openedWorkbench).toHaveBeenCalledTimes(1)
    expect((openedWorkbench.mock.calls[0][0] as CustomEvent).detail.options.root).toBe(
      'D:\\workspace'
    )
    openedWorkbench.mockClear()

    await act(async () => {
      ; (findEl('UNC') as HTMLElement).click()
    })
    expect(openedWorkbench).toHaveBeenCalledTimes(1)
    expect((openedWorkbench.mock.calls[0][0] as CustomEvent).detail.options.root).toMatch(
      /^\\\\server\\share\\?$/
    )

    const invoke = (window.bridge as { invoke: ReturnType<typeof vi.fn> }).invoke
    await act(async () => {
      ; (findEl('External') as HTMLElement).click()
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalledWith('browser:openUrl', '', 'https://example.com/docs')

    await act(async () => {
      ; (findEl('Anchor') as HTMLElement).click()
    })
    expect(scrollIntoView).toHaveBeenCalledOnce()
    window.removeEventListener('larify:workbench-open', openedWorkbench)
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
