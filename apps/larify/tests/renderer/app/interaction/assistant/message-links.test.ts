// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageLinkHandler } from '../../../../../src/renderer/src/app/interaction/assistant/message-links'

const dispatchSpy = vi.hoisted(() => vi.fn())

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createMessageLinkHandler', () => {
  const cwd = 'D:\\Workspace\\Project'
  const sessionId = 'session-1'

  beforeEach(() => {
    dispatchSpy.mockClear()
    vi.stubGlobal('dispatchEvent', dispatchSpy)
    window.bridge = {
      invoke: vi.fn().mockResolvedValue(42)
    } as unknown as typeof window.bridge
  })

  it('opens a file link in the workspace renderer with a computed root', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'src\\main\\index.ts' })

    const event = dispatchSpy.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe('larify:workbench-open')
    const detail = event.detail as {
      rendererId: string
      options: { root: string }
      onOpen: (resourceId: number) => void
    }
    expect(detail.rendererId).toBe('workspace')
    // 目标文件在工作区内 → root 保持为 cwd
    expect(detail.options.root).toBe(cwd)
    // onOpen 回调触发工作区导航定位
    expect(typeof detail.onOpen).toBe('function')
  })

  it('opens a url link in the built-in browser and selects the resource', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://example.com/doc' })

    expect(window.bridge.invoke).toHaveBeenCalledWith('resource:create', 'browser', sessionId, {
      url: 'https://example.com/doc'
    })

    // 等待 resource:create resolve 后应派发选中浏览器资源事件
    await vi.waitFor(() => {
      const selects = dispatchSpy.mock.calls
        .map(([e]) => e as CustomEvent)
        .filter((event) => event.type === 'larify:workbench-select-resource')
      expect(selects).toHaveLength(1)
      expect(selects[0].detail).toEqual({
        rendererId: 'browser',
        resourceId: 42,
        sessionId
      })
    })
  })

  it('selects only the latest url when creations finish out of order', async () => {
    const first = deferred<number>()
    const second = deferred<number>()
    vi.mocked(window.bridge.invoke)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://first.example' })
    handler({ kind: 'url', target: 'https://second.example' })
    second.resolve(2)
    await Promise.resolve()
    first.resolve(1)
    await Promise.resolve()

    const selections = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .filter((event) => event.type === 'larify:workbench-select-resource')
    expect(selections).toHaveLength(1)
    expect(selections[0].detail.resourceId).toBe(2)
    expect(window.bridge.invoke).toHaveBeenCalledWith('resource:close', 1)
  })

  it('does not select a pending browser resource after a file link is opened', async () => {
    const browser = deferred<number>()
    vi.mocked(window.bridge.invoke).mockReturnValueOnce(browser.promise)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://example.com' })
    handler({ kind: 'file', target: 'README.md' })
    browser.resolve(1)
    await Promise.resolve()

    const selections = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .filter((event) => event.type === 'larify:workbench-select-resource')
    expect(selections).toHaveLength(0)
    expect(window.bridge.invoke).toHaveBeenCalledWith('resource:close', 1)
  })

  it('navigates only the latest file when workspace callbacks run out of order', () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'first.ts' })
    handler({ kind: 'file', target: 'second.ts' })
    const opens = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent<{ onOpen: (resourceId: number) => void }>)
      .filter((event) => event.type === 'larify:workbench-open')

    opens[1].detail.onOpen(2)
    opens[0].detail.onOpen(1)

    const navigations = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .filter((event) => event.type === 'larify:workspace-navigation')
    expect(navigations).toHaveLength(1)
    expect(navigations[0].detail).toEqual({
      path: 'D:\\Workspace\\Project\\second.ts',
      resourceId: 2
    })
  })

  it('logs browser creation failures without selecting a resource', async () => {
    const error = new Error('create failed')
    vi.mocked(window.bridge.invoke).mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://example.com' })
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('[message-link:open-browser]', error)
    })

    expect(dispatchSpy).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('closes a pending browser resource after the handler is disposed', async () => {
    const browser = deferred<number>()
    vi.mocked(window.bridge.invoke).mockReturnValueOnce(browser.promise)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://example.com' })
    handler.dispose()
    browser.resolve(3)
    await Promise.resolve()

    expect(window.bridge.invoke).toHaveBeenCalledWith('resource:close', 3)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('ignores a pending workspace callback after the handler is disposed', () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'README.md' })
    const open = dispatchSpy.mock.calls[0][0] as CustomEvent<{
      onOpen: (resourceId: number) => void
    }>
    handler.dispose()
    open.detail.onOpen(4)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('does nothing when a disposed handler is called again', () => {
    const handler = createMessageLinkHandler(cwd, sessionId)
    handler.dispose()

    handler({ kind: 'url', target: 'https://example.com' })
    handler({ kind: 'file', target: 'README.md' })

    expect(window.bridge.invoke).not.toHaveBeenCalled()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['src/a%20b.ts?raw=1#L10', 'D:\\Workspace\\Project\\src\\a b.ts', 'L10'],
    ['file:///D:/Other/a%20b.ts#section', 'D:\\Other\\a b.ts', 'section']
  ])('normalizes file link %s', (target, expectedPath, expectedHash) => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target })

    const detail = (dispatchSpy.mock.calls[0][0] as CustomEvent).detail as {
      onOpen: (resourceId: number) => void
    }
    detail.onOpen(7)
    const navigation = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .find((event) => event.type === 'larify:workspace-navigation')
    expect(navigation?.detail).toEqual({ path: expectedPath, hash: expectedHash, resourceId: 7 })
  })

  it('falls back the workspace root to the target directory for out-of-cwd files', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'D:\\Other\\notes\\readme.md' })

    const detail = (
      dispatchSpy.mock.calls[0][0] as CustomEvent<{
        options: { root: string }
      }>
    ).detail
    expect(detail.options.root).toBe('D:\\Other\\notes')
  })
})
