// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  onDidChange: vi.fn(() => () => undefined),
  readAsset: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' })),
  readFile: vi.fn(async () => '# Heading'),
  invoke: vi.fn(async (channel: string) => {
    if (channel === 'workspace:path-kind') return 'file'
    if (channel === 'browser:openUrl') return 99
    return undefined
  })
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    inspectFile: h.inspectFile,
    onDidChange: h.onDidChange,
    readAsset: h.readAsset,
    readFile: h.readFile
  }
}))

import { MarkdownPreview } from '../../../../src/extensions/workspace/renderer/preview/markdown-preview'

const markdown = [
  '# Heading',
  '',
  '[guide](docs/Guide%20One.md#Install)',
  '[bad](bad%link.md)',
  '[absolute](D:/workspace/absolute.md)',
  '[unc](\\\\server\\share\\document.md)',
  '[external](https://example.com/docs)',
  '[anchor](#heading)',
  '',
  '![alt](./image.png)'
].join('\n')

const fileProps = {
  file: { binary: false, mime: 'text/markdown', path: 'D:\\workspace\\README.md' },
  resourceId: 7,
  sessionId: 'session-1'
}

describe('MarkdownPreview integration (Streamdown)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    h.readFile.mockResolvedValue(markdown)
    h.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'workspace:path-kind') return 'file'
      if (channel === 'browser:openUrl') return 99
      return undefined
    })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:local-image'),
      revokeObjectURL: vi.fn()
    })
    vi.stubGlobal('bridge', { invoke: h.invoke })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const render = async (props: Record<string, unknown> = {}): Promise<void> => {
    await act(async () => {
      root.render(createElement(MarkdownPreview, { ...fileProps, ...props }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const clickable = (label: string): HTMLElement => {
    const el = Array.from(container.querySelectorAll<HTMLElement>('.larify-message-link')).find(
      (candidate) => candidate.textContent === label
    )
    if (!el) throw new Error(`link not found: ${label}`)
    return el
  }

  it('generates GitHub-style heading ids with rehype-slug', async () => {
    await render()
    expect(container.querySelector('h1')?.getAttribute('id')).toBe('heading')
  })

  it('routes local file links through the workspace', async () => {
    const opened = vi.fn()
    window.addEventListener('larify:workbench-open', opened)
    await render()

    await act(async () => clickable('guide').click())
    const event = opened.mock.calls[0]?.[0] as CustomEvent | undefined
    expect(event?.type).toBe('larify:workbench-open')
    const detail = event?.detail as { options: { root: string } }
    // cwd = dirname(README.md) = D:\workspace，目标在其内 → root 保持 cwd
    expect(detail.options.root).toBe('D:\\workspace')
    window.removeEventListener('larify:workbench-open', opened)
  })

  it('opens web links in the built-in browser with the component session id', async () => {
    await render()

    await act(async () => clickable('external').click())
    expect(h.invoke).toHaveBeenCalledWith('browser:openUrl', 'session-1', 'https://example.com/docs')
  })

  it('scrolls to document anchors without navigating', async () => {
    await render()
    const scrollIntoView = vi.fn()
    Object.assign(container.querySelector('h1')!, { scrollIntoView })

    const anchor = clickable('anchor')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => anchor.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('does not crash on malformed percent escapes', async () => {
    await render()
    expect(() => clickable('bad').click()).not.toThrow()
    // 不会派发任何打开动作（解析失败即忽略）
    await act(async () => clickable('bad').click())
  })

  it('loads local images through the workspace client', async () => {
    await render()
    await vi.waitFor(() => expect(h.readAsset).toHaveBeenCalledWith(7, 'D:\\workspace\\image.png'))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-image')
  })

  it('replays the same target hash when a new navigation target arrives', async () => {
    await render()
    const scrollIntoView = vi.fn()
    Object.assign(container.querySelector('h1')!, { scrollIntoView })

    await render({ target: { hash: 'heading' } })
    await render({ target: { hash: 'heading' } })

    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('defers reading an inactive preview until it becomes active', async () => {
    h.readFile.mockClear()
    await render({ active: false })
    expect(h.readFile).not.toHaveBeenCalled()

    await render({ active: true })
    expect(h.readFile).toHaveBeenCalledOnce()
  })
})
