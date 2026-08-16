// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeFilePreview } from '../../../../src/extensions/workspace/renderer/preview/native-file-preview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  private readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  disconnect(): void {
    this.targets.clear()
  }

  notify(): void {
    this.callback(
      [...this.targets].map((target) => ({ target }) as ResizeObserverEntry),
      this as unknown as ResizeObserver
    )
  }
}

describe('NativeFilePreview', () => {
  let container: HTMLDivElement
  let root: Root
  let invoke: ReturnType<typeof vi.fn>
  let send: ReturnType<typeof vi.fn>
  let sendSync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    invoke = vi.fn().mockResolvedValue(undefined)
    send = vi.fn()
    sendSync = vi.fn(() => true)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    FakeResizeObserver.instances = []
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, send, sendSync }
    })
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: FakeResizeObserver
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 200,
      left: 10,
      right: 310,
      top: 40,
      width: 300,
      x: 10,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports native bounds before the native view becomes visible', async () => {
    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'document.pdf' },
          resourceId: 42
        })
      )
    )
    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 300,
      x: 10,
      y: 40
    })
    expect(send).toHaveBeenCalledWith('workspace-preview:setVisible', 42, true)
    expect(sendSync.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
  })

  it('deduplicates repeated resize notifications', async () => {
    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'document.pdf' },
          resourceId: 42
        })
      )
    )
    send.mockClear()
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 20,
      right: 280,
      top: 40,
      width: 260,
      x: 20,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () => {
      FakeResizeObserver.instances[0]?.notify()
      FakeResizeObserver.instances[0]?.notify()
    })
    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 260,
      x: 20,
      y: 40
    })
    expect(sendSync).toHaveBeenCalledTimes(1)
  })

  it('uses stable host bounds when the Allotment pane is narrower', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      const left = this.classList.contains('split-view-view') ? 280 : 10
      return {
        bottom: 240,
        height: 200,
        left,
        right: 310,
        top: 40,
        width: 310 - left,
        x: left,
        y: 40,
        toJSON: () => ({})
      } as DOMRect
    })

    await act(async () =>
      root.render(
        createElement(
          'div',
          { className: 'split-view-view' },
          createElement(NativeFilePreview, {
            active: true,
            file: { binary: true, mime: 'application/pdf', path: 'document.pdf' },
            resourceId: 42
          })
        )
      )
    )
    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 300,
      x: 10,
      y: 40
    })
  })

  it('reports position-only changes after a window resize', async () => {
    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'document.pdf' },
          resourceId: 42
        })
      )
    )
    send.mockClear()
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 30,
      right: 330,
      top: 40,
      width: 300,
      x: 30,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)
    window.dispatchEvent(new Event('resize'))

    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 300,
      x: 30,
      y: 40
    })
  })

  it('synchronously reports geometry after the native layout event', async () => {
    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'document.pdf' },
          resourceId: 42
        })
      )
    )
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 30,
      right: 290,
      top: 40,
      width: 260,
      x: 30,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)

    window.dispatchEvent(new Event('larify:native-layout'))
    FakeResizeObserver.instances[0]?.notify()

    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 260,
      x: 30,
      y: 40
    })
    expect(sendSync).toHaveBeenCalledTimes(1)
  })

  it('tracks position-only changes while the workbench is animating', async () => {
    let frame: FrameRequestCallback | undefined
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    const file = { binary: true, mime: 'application/pdf', path: 'document.pdf' }
    await act(async () =>
      root.render(
        createElement(NativeFilePreview, { active: true, animating: true, file, resourceId: 42 })
      )
    )
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 50,
      right: 350,
      top: 40,
      width: 300,
      x: 50,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () => frame?.(performance.now()))

    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 300,
      x: 50,
      y: 40
    })

    await act(async () =>
      root.render(
        createElement(NativeFilePreview, { active: true, animating: false, file, resourceId: 42 })
      )
    )
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 30,
      right: 330,
      top: 40,
      width: 300,
      x: 30,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () => frame?.(performance.now()))

    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 300,
      x: 30,
      y: 40
    })
  })

  it('opens content, updates visibility, and closes on unmount', async () => {
    const file = { binary: true, mime: 'application/pdf', path: 'document.pdf' }
    await act(async () =>
      root.render(createElement(NativeFilePreview, { active: true, file, resourceId: 42 }))
    )

    expect(invoke).toHaveBeenCalledWith(
      'workspace-preview:open',
      42,
      'document.pdf',
      'application/pdf',
      expect.any(String),
      { height: 200, width: 300, x: 10, y: 40 },
      true
    )

    await act(async () =>
      root.render(createElement(NativeFilePreview, { active: false, file, resourceId: 42 }))
    )
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('workspace-preview:setVisible', 42, false)
    expect(
      send.mock.calls.filter(
        ([channel, id, visible]) =>
          channel === 'workspace-preview:setVisible' && id === 42 && visible === false
      )
    ).toHaveLength(1)

    await act(async () => root.unmount())
    expect(send).toHaveBeenCalledWith('workspace-preview:close', 42)
  })

  it('reports fresh bounds before showing a preview that becomes active', async () => {
    const file = { binary: true, mime: 'application/pdf', path: 'document.pdf' }
    await act(async () =>
      root.render(createElement(NativeFilePreview, { active: false, file, resourceId: 42 }))
    )
    expect(sendSync).not.toHaveBeenCalledWith(
      'workspace-preview:setBoundsSync',
      42,
      expect.anything()
    )
    send.mockClear()
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 260,
      height: 200,
      left: 40,
      right: 340,
      top: 60,
      width: 300,
      x: 40,
      y: 60,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () =>
      root.render(createElement(NativeFilePreview, { active: true, file, resourceId: 42 }))
    )

    expect(sendSync).toHaveBeenCalledWith('workspace-preview:setBoundsSync', 42, {
      height: 200,
      width: 300,
      x: 40,
      y: 60
    })
    expect(send).toHaveBeenCalledWith('workspace-preview:setVisible', 42, true)
    expect(sendSync.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
  })

  it('handles a native preview open failure', async () => {
    const error = new Error('open failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    invoke.mockRejectedValueOnce(error)

    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'document.pdf' },
          resourceId: 42
        })
      )
    )

    expect(consoleError).toHaveBeenCalledWith('[workspace:native-preview]', error)
  })

  it('reuses the native preview when its file changes', async () => {
    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'first.pdf' },
          resourceId: 42
        })
      )
    )
    send.mockClear()

    await act(async () =>
      root.render(
        createElement(NativeFilePreview, {
          active: true,
          file: { binary: true, mime: 'application/pdf', path: 'second.pdf' },
          resourceId: 42
        })
      )
    )

    expect(invoke).toHaveBeenLastCalledWith(
      'workspace-preview:open',
      42,
      'second.pdf',
      'application/pdf',
      expect.any(String),
      { height: 200, width: 300, x: 10, y: 40 },
      true
    )
    expect(send).not.toHaveBeenCalledWith('workspace-preview:close', 42)
  })
})
