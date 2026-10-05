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
      invoke: vi.fn((channel: string) => {
        if (channel === 'workspace:path-kind') return Promise.resolve('file')
        if (channel === 'workspace:default-root')
          return Promise.resolve('C:\\Users\\hylnb\\.larify\\workspace')
        return Promise.resolve(42)
      })
    } as unknown as typeof window.bridge
  })

  it('opens a file link in the workspace renderer with a computed root', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'src\\main\\index.ts' })

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())

    const event = dispatchSpy.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe('larify:workbench-open')
    const detail = event.detail as {
      rendererId: string
      navigation: { path: string }
      options: { root: string }
      onOpen: (resourceId: number) => void
    }
    expect(detail.rendererId).toBe('workspace')
    // 目标文件在工作区内 → root 保持为 cwd
    expect(detail.options.root).toBe(cwd)
    // `navigation.path` 声明导航目标，同时参与工作台的复用键
    // （不同文件新开标签、同一文件复用标签），不再依赖调用方另传 `options.file`
    expect(detail.navigation.path).toBe(`${cwd}\\src\\main\\index.ts`)
    // onOpen 回调触发工作区导航定位
    expect(typeof detail.onOpen).toBe('function')
  })

  it('declares a stable per-file navigation target so different files open separate tabs', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'src\\a.ts' })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(1))
    handler({ kind: 'file', target: 'src\\b.ts' })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(2))
    handler({ kind: 'file', target: 'src\\a.ts' })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(3))

    const targets = dispatchSpy.mock.calls.map(
      ([event]) => (event as CustomEvent<{ navigation: { path: string } }>).detail.navigation.path
    )
    // 不同文件 ⇒ 不同复用目标；同一文件重复打开 ⇒ 目标稳定一致
    expect(targets).toEqual([
      `${cwd}\\src\\a.ts`,
      `${cwd}\\src\\b.ts`,
      `${cwd}\\src\\a.ts`
    ])
    expect(targets[0]).toBe(targets[2])
    expect(targets[0]).not.toBe(targets[1])
  })

  it('opens a url link in the built-in browser and selects the resource', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://example.com/doc' })

    expect(window.bridge.invoke).toHaveBeenCalledWith(
      'browser:openUrl',
      sessionId,
      'https://example.com/doc'
    )

    // 等待 browser:openUrl resolve 后应派发选中浏览器资源事件
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
    expect(window.bridge.invoke).not.toHaveBeenCalledWith('resource:close', 1)
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
    expect(window.bridge.invoke).not.toHaveBeenCalledWith('resource:close', 1)
  })

  it('navigates only the latest file when workspace callbacks run out of order', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    vi.mocked(window.bridge.invoke)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'first.ts' })
    handler({ kind: 'file', target: 'second.ts' })
    second.resolve('file')
    first.resolve('file')
    await vi.waitFor(() =>
      expect(
        dispatchSpy.mock.calls.filter(
          ([event]) => (event as CustomEvent).type === 'larify:workbench-open'
        )
      ).toHaveLength(1)
    )
    const opens = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent<{ onOpen: (resourceId: number) => void }>)
      .filter((event) => event.type === 'larify:workbench-open')

    opens[0].detail.onOpen(2)

    const navigations = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .filter((event) => event.type === 'larify:workspace-navigation')
    expect(navigations).toHaveLength(1)
    expect(navigations[0].detail).toEqual({
      path: 'D:\\Workspace\\Project\\second.ts',
      resourceId: 2
    })
  })

  it('ignores an already-open workspace callback after a newer link is clicked', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'first.ts' })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(1))
    const firstOpen = dispatchSpy.mock.calls[0][0] as CustomEvent<{
      onOpen: (resourceId: number) => void
    }>

    handler({ kind: 'file', target: 'second.ts' })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(2))
    const secondOpen = dispatchSpy.mock.calls[1][0] as CustomEvent<{
      onOpen: (resourceId: number) => void
    }>

    firstOpen.detail.onOpen(1)
    secondOpen.detail.onOpen(2)

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

  it('logs path inspection failures without opening a workspace', async () => {
    const error = new Error('inspect failed')
    vi.mocked(window.bridge.invoke).mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'missing.ts' })
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('[message-link:inspect-path]', error)
    })

    expect(dispatchSpy).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('logs path inspection failures in the default space without opening a workspace', async () => {
    const error = new Error('inspect failed')
    vi.mocked(window.bridge.invoke).mockImplementation((channel) => {
      if (channel === 'workspace:default-root')
        return Promise.resolve('C:\\Users\\hylnb\\.larify\\workspace')
      return Promise.reject(error)
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createMessageLinkHandler('', sessionId)

    handler({ kind: 'file', target: 'missing.ts' })
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('[message-link:inspect-path]', error)
    })

    expect(dispatchSpy).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('resolves a relative file link in the default space against the fallback root', async () => {
    const handler = createMessageLinkHandler('', sessionId)

    handler({ kind: 'file', target: 'src/main.ts' })

    // 默认空间先向主进程取应用工作区根，再把相对路径解析为绝对路径并打开。
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())
    expect(window.bridge.invoke).toHaveBeenCalledWith('workspace:default-root')
    expect(window.bridge.invoke).toHaveBeenCalledWith(
      'workspace:path-kind',
      'C:\\Users\\hylnb\\.larify\\workspace\\src\\main.ts'
    )
  })

  it('does not select a pending browser resource after the handler is disposed', async () => {
    const browser = deferred<number>()
    vi.mocked(window.bridge.invoke).mockReturnValueOnce(browser.promise)
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'url', target: 'https://example.com' })
    handler.dispose()
    browser.resolve(3)
    await Promise.resolve()

    expect(window.bridge.invoke).not.toHaveBeenCalledWith('resource:close', 3)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('ignores a pending workspace callback after the handler is disposed', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target: 'README.md' })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())
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
  ])('normalizes file link %s', async (target, expectedPath, expectedHash) => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({ kind: 'file', target })

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())

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

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())

    const detail = (
      dispatchSpy.mock.calls[0][0] as CustomEvent<{
        options: { root: string }
      }>
    ).detail
    expect(detail.options.root).toBe('D:\\Other\\notes')
  })

  it('anchors a memory file link to the whole ~/.larify/memory root', async () => {
    const handler = createMessageLinkHandler(cwd, sessionId)

    handler({
      kind: 'file',
      target: 'C:\\Users\\hylnb\\.larify\\memory\\larify-desktop\\index.md'
    })

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())

    const detail = (
      dispatchSpy.mock.calls[0][0] as CustomEvent<{
        options: { root: string }
      }>
    ).detail
    expect(detail.options.root).toBe('C:\\Users\\hylnb\\.larify\\memory')
  })

  it('anchors a tasks file link to the whole ~/.larify/tasks root', async () => {
    const handler = createMessageLinkHandler('', sessionId)

    handler({
      kind: 'file',
      target: 'C:\\Users\\hylnb\\.larify\\tasks\\some-task\\task.md'
    })

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())

    const detail = (
      dispatchSpy.mock.calls[0][0] as CustomEvent<{
        options: { root: string }
      }>
    ).detail
    expect(detail.options.root).toBe('C:\\Users\\hylnb\\.larify\\tasks')
  })

  it('opens a Windows absolute file from the default space', async () => {
    const handler = createMessageLinkHandler('', sessionId)

    handler({ kind: 'file', target: 'C:\\Users\\test\\notes\\说明.md' })

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())

    const detail = (
      dispatchSpy.mock.calls[0][0] as CustomEvent<{
        options: { root: string }
        onOpen: (resourceId: number) => void
      }>
    ).detail
    expect(detail.options.root).toBe('C:\\Users\\test\\notes')

    detail.onOpen(9)
    const navigation = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .find((event) => event.type === 'larify:workspace-navigation')
    expect(navigation?.detail).toEqual({
      path: 'C:\\Users\\test\\notes\\说明.md',
      resourceId: 9
    })
  })

  it('opens a directory link as the workspace root without file navigation', async () => {
    vi.mocked(window.bridge.invoke).mockImplementation((channel, ...args) => {
      if (channel === 'workspace:path-kind')
        return Promise.resolve((args[0] as string).endsWith('workspace') ? 'directory' : 'file')
      if (channel === 'workspace:default-root')
        return Promise.resolve('C:\\Users\\hylnb\\.larify\\workspace')
      return Promise.resolve(42)
    })
    const handler = createMessageLinkHandler('', sessionId)

    handler({ kind: 'file', target: 'C:\\Users\\test\\workspace' })

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent<{
      rendererId: string
      options: { root: string }
      onOpen?: unknown
    }>
    expect(event.detail.rendererId).toBe('workspace')
    expect(event.detail.options).toEqual({ root: 'C:\\Users\\test\\workspace' })
    expect(typeof event.detail.onOpen).toBe('function')

    ;(event.detail.onOpen as (resourceId: number) => void)(10)
    const navigation = dispatchSpy.mock.calls
      .map(([candidate]) => candidate as CustomEvent)
      .find((candidate) => candidate.type === 'larify:workspace-navigation')
    expect(navigation?.detail).toEqual({
      kind: 'directory',
      path: 'C:\\Users\\test\\workspace',
      resourceId: 10
    })
  })
})
