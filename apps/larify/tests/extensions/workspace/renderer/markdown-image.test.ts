// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ readAsset: vi.fn() }))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: { readAsset: h.readAsset }
}))

import { WorkspaceMarkdownImage } from '../../../../src/extensions/workspace/renderer/preview/markdown-image'

describe('WorkspaceMarkdownImage', () => {
  let container: HTMLDivElement
  let root: Root
  let rootMounted: boolean
  const createObjectURL = vi.fn(() => 'blob:local-image')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    h.readAsset.mockReset()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    rootMounted = true
  })

  afterEach(async () => {
    if (rootMounted) await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('loads a decoded local path and releases its object URL', async () => {
    h.readAsset.mockResolvedValue({ bytes: new Uint8Array([1, 2]), mime: 'image/png' })
    await render({ alt: 'diagram', src: './images/My%20Diagram.png?raw=1#preview' })

    expect(h.readAsset).toHaveBeenCalledWith(7, 'D:\\workspace\\docs\\images\\My Diagram.png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-image')

    await render({ src: 'https://example.com/next.png' })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-image')
  })

  it('does not reload when only a local image query or hash changes', async () => {
    h.readAsset.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png' })
    await render({ src: './image.png?first' })
    await render({ src: './image.png?second#preview' })

    expect(h.readAsset).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it.each(['https://example.com/image.png', 'data:image/png,x', 'blob:local-image'])(
    'leaves remote source %s to the browser',
    async (src) => {
      await render({ src })
      expect(container.querySelector('img')?.getAttribute('src')).toBe(src)
      expect(h.readAsset).not.toHaveBeenCalled()
    }
  )

  it('normalizes a protocol-relative image to HTTPS', async () => {
    const src = '//cdn.example.com/image.png'
    await render({ src })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(`https:${src}`)
    expect(h.readAsset).not.toHaveBeenCalled()
  })

  it('does not show a stale local URL after switching to a remote source', async () => {
    h.readAsset.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png' })
    await render({ src: './local.png' })
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-image')

    await render({ src: 'https://example.com/remote.png' })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/remote.png'
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-image')
  })

  it('replaces and releases a local image when its path changes', async () => {
    h.readAsset.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png' })
    createObjectURL.mockReturnValueOnce('blob:first-image').mockReturnValueOnce('blob:second-image')
    await render({ src: './first.png' })
    await render({ src: './second.png' })

    expect(h.readAsset).toHaveBeenNthCalledWith(1, 7, 'D:\\workspace\\docs\\first.png')
    expect(h.readAsset).toHaveBeenNthCalledWith(2, 7, 'D:\\workspace\\docs\\second.png')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first-image')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:second-image')
  })

  it('renders no local source when the IPC read fails', async () => {
    h.readAsset.mockRejectedValue(new Error('read failed'))
    await render({ alt: 'missing', src: './missing.png' })

    expect(container.querySelector('img')?.hasAttribute('src')).toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('ignores a local load that completes after the source changes', async () => {
    let complete!: (asset: { bytes: Uint8Array; mime: string }) => void
    h.readAsset.mockReturnValue(new Promise((resolve) => (complete = resolve)))
    await render({ src: './slow.png' })
    await render({ src: 'https://example.com/remote.png' })
    await act(async () => complete({ bytes: new Uint8Array([1]), mime: 'image/png' }))

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/remote.png'
    )
  })

  it('ignores a local load that completes after unmount', async () => {
    let complete!: (asset: { bytes: Uint8Array; mime: string }) => void
    h.readAsset.mockReturnValue(new Promise((resolve) => (complete = resolve)))
    await render({ src: './slow.png' })
    await act(async () => root.unmount())
    rootMounted = false
    await act(async () => complete({ bytes: new Uint8Array([1]), mime: 'image/png' }))

    expect(createObjectURL).not.toHaveBeenCalled()
  })

  async function render(props: Record<string, unknown>): Promise<void> {
    await act(async () => {
      root.render(
        createElement(WorkspaceMarkdownImage, {
          currentFile: 'D:\\workspace\\docs\\README.md',
          resourceId: 7,
          ...props
        })
      )
      await Promise.resolve()
    })
  }
})
