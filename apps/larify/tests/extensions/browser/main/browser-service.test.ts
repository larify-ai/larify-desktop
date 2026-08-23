import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceManager } from '../../../../src/main/core/resource'
import type { BrowserState } from '../../../../src/extensions/browser/shared/types'

const h = vi.hoisted(() => ({
  nativeTheme: {
    shouldUseDarkColors: false,
    on: vi.fn(),
    removeListener: vi.fn()
  },
  managers: [] as Array<{
    tabs: Map<number, unknown>
    createTab: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    setColorScheme: ReturnType<typeof vi.fn>
    setRecording: ReturnType<typeof vi.fn>
    isRecording: ReturnType<typeof vi.fn>
    withRendered: ReturnType<typeof vi.fn>
    withUnthrottled: ReturnType<typeof vi.fn>
    recordStart: ReturnType<typeof vi.fn>
    recordStop: ReturnType<typeof vi.fn>
    recordStopIfCurrent: ReturnType<typeof vi.fn>
    recordRestart: ReturnType<typeof vi.fn>
    navigate: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    openTab(url?: string): void
    emit(state: BrowserState): void
  }>
}))

vi.mock('electron', () => ({
  nativeTheme: h.nativeTheme,
  session: { fromPartition: vi.fn() }
}))

vi.mock('../../../../src/extensions/browser/main/tab-manager', () => ({
  BrowserTabManager: class {
    tabs = new Map<number, unknown>()
    createTab = vi.fn((id: number, url?: string) => {
      if (url === 'fail:') throw new Error('open failed')
      const tab = {
        id,
        ready: vi.fn(async () => undefined),
        state: () => ({ id, title: `Page ${id}`, ...(url === undefined ? {} : { url }) })
      }
      this.tabs.set(id, tab)
      return tab
    })
    get = (id: number): unknown => this.tabs.get(id)
    close = vi.fn(async (id: number) => {
      this.tabs.delete(id)
    })
    attach = vi.fn()
    setColorScheme = vi.fn()
    state = (): { tabs: unknown[] } => ({
      tabs: [...this.tabs.values()].map((tab) => (tab as { state(): unknown }).state())
    })
    onChange?: (state: BrowserState) => void
    bindChange = vi.fn((callback: (state: BrowserState) => void) => {
      this.onChange = callback
    })
    setRecording = vi.fn((id: number | null) => {
      if (id !== null && !this.tabs.has(id)) throw new Error('browser tab not found')
    })
    isRecording = vi.fn(() => true)
    withRendered = vi.fn(async (_id: number, operation: () => Promise<unknown>) => operation())
    withUnthrottled = vi.fn(async (_id: number, operation: () => Promise<unknown>) => operation())
    recordStart = vi.fn(async () => 1)
    recordStop = vi.fn(async () => ({ path: 'recording.webm', bytes: 1 }))
    recordStopIfCurrent = vi.fn(async () => ({ path: 'recording.webm', bytes: 1 }))
    recordRestart = vi.fn(async () => 2)
    navigate = vi.fn(() => true)
    goBack = vi.fn()
    goForward = vi.fn()
    reload = vi.fn()
    destroy = vi.fn()
    emit = (state: BrowserState): void => {
      this.onChange?.(state)
    }
    constructor(private readonly requestOpen: (url?: string) => void) {
      h.managers.push(this)
    }
    openTab = (url?: string): void => this.requestOpen(url)
  }
}))

import { BrowserService } from '../../../../src/extensions/browser/main/browser-service'

describe('BrowserService resources', () => {
  beforeEach(() => {
    h.managers.splice(0)
    h.nativeTheme.shouldUseDarkColors = false
    h.nativeTheme.on.mockClear()
    h.nativeTheme.removeListener.mockClear()
  })

  it('keeps browser guests in sync with the native color scheme', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({ webContents: { send: vi.fn() } } as never, resources)
    service.createTab('session-a')
    const update = h.nativeTheme.on.mock.calls.find(([event]) => event === 'updated')?.[1]

    h.nativeTheme.shouldUseDarkColors = true
    update()
    expect(h.managers[0].setColorScheme).toHaveBeenCalledWith('dark')

    await service.destroy()
    expect(h.nativeTheme.removeListener).toHaveBeenCalledWith('updated', update)
  })

  it('uses globally allocated resource ids across sessions', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    expect(service.createTab('session-a')).toBe(1)
    expect(service.createTab('session-b', 'https://example.com')).toBe(2)
    expect(resources.list()).toEqual([
      { id: 1, type: 'browser', sessionId: 'session-a' },
      { id: 2, type: 'browser', sessionId: 'session-b' }
    ])
    expect(h.managers[0].createTab).toHaveBeenCalledWith(1, undefined)
    expect(h.managers[1].createTab).toHaveBeenCalledWith(2, 'https://example.com')
  })

  it('keeps agent-created tabs in the background', () => {
    const send = vi.fn()
    const service = new BrowserService({ webContents: { send } } as never, new ResourceManager())

    service.createTab('session-a', 'https://example.com')

    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a guest attachment for an unknown session', () => {
    const service = new BrowserService({} as never, new ResourceManager())

    expect(() => service.attach('missing-session', 1, {} as never)).toThrow(
      'browser session not found'
    )
    expect(h.managers).toHaveLength(0)
  })

  it('reuses an agent-created tab when a message opens the same URL', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const existing = service.createTab('session-a', 'https://example.com')

    expect(service.openUrl('session-a', 'https://example.com/')).toBe(existing)
    expect(resources.list({ sessionId: 'session-a', type: 'browser' })).toHaveLength(1)
  })

  it('reuses the same document and navigates when only the URL fragment changes', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const existing = service.createTab('session-a', 'https://example.com/guide#start')

    expect(service.openUrl('session-a', 'https://example.com/guide#details')).toBe(existing)
    expect(h.managers[0].navigate).toHaveBeenCalledWith(
      existing,
      'https://example.com/guide#details'
    )
    expect(resources.list({ sessionId: 'session-a', type: 'browser' })).toHaveLength(1)
  })

  it('creates separate tabs for different message URLs and sessions', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const existing = service.createTab('session-a', 'https://example.com/one')

    expect(service.openUrl('session-a', 'https://example.com/two')).not.toBe(existing)
    expect(service.openUrl('session-b', 'https://example.com/one')).not.toBe(existing)
    expect(resources.list({ type: 'browser' })).toHaveLength(3)
  })

  it('does not retain a resource or manager when opening fails', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)

    expect(() => service.createTab('session-a', 'fail:')).toThrow('open failed')

    expect(resources.list()).toEqual([])
    expect(h.managers[0].destroy).toHaveBeenCalledOnce()
    expect(service.state('session-a')).toEqual({ tabs: [] })
  })

  it('closes the native tab through ResourceManager', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.close('session-a', id)
    expect(resources.get(id)).toBeUndefined()
    expect(h.managers[0].close).toHaveBeenCalledWith(id)
    expect(h.managers[0].destroy).not.toHaveBeenCalled()
  })

  it('delegates render and activity leases to the owning session manager', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')

    await expect(service.withRendered('session-a', id, async () => 'rendered')).resolves.toBe(
      'rendered'
    )
    await expect(service.withUnthrottled('session-a', id, async () => 'active')).resolves.toBe(
      'active'
    )
    expect(h.managers[0].withRendered).toHaveBeenCalledWith(id, expect.any(Function))
    expect(h.managers[0].withUnthrottled).toHaveBeenCalledWith(id, expect.any(Function))
  })

  it('waits for the manager render lease before staging the renderer host', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const id = service.createTab('session-a')
    h.managers[0].withRendered.mockImplementationOnce(async (_id, operation) => {
      expect(executeJavaScript).not.toHaveBeenCalled()
      return operation()
    })

    await service.withRendered('session-a', id, async () => undefined)

    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('keeps one renderer lease while overlapping rendered operations are active', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const id = service.createTab('session-a')
    let finishFirst!: () => void
    let finishSecond!: () => void

    const first = service.withRendered(
      'session-a',
      id,
      () => new Promise<void>((resolve) => { finishFirst = resolve })
    )
    const second = service.withRendered(
      'session-a',
      id,
      () => new Promise<void>((resolve) => { finishSecond = resolve })
    )
    await vi.waitFor(() => {
      expect(finishFirst).toBeTypeOf('function')
      expect(finishSecond).toBeTypeOf('function')
    })
    expect(executeJavaScript).toHaveBeenCalledOnce()

    finishFirst()
    await first
    expect(executeJavaScript).toHaveBeenCalledOnce()
    finishSecond()
    await second
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('releases the renderer lease when a rendered operation fails', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const id = service.createTab('session-a')

    await expect(
      service.withRendered('session-a', id, async () => { throw new Error('operation failed') })
    ).rejects.toThrow('operation failed')

    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('discards a renderer lease when its resource closes during an operation', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const resources = new ResourceManager()
    const service = new BrowserService({ webContents: { executeJavaScript } } as never, resources)
    const id = service.createTab('session-a')
    let finishOperation!: () => void
    const operation = service.withRendered(
      'session-a',
      id,
      () => new Promise<void>((resolve) => { finishOperation = resolve })
    )
    await vi.waitFor(() => expect(finishOperation).toBeTypeOf('function'))

    await service.close('session-a', id)
    expect(executeJavaScript).toHaveBeenCalledTimes(2)

    finishOperation()
    await operation
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('waits for the webview attachment before staging a recording', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const id = service.createTab('session-a')
    const tab = service.tab('session-a', id)!
    vi.mocked(tab.ready).mockImplementationOnce(async () => {
      expect(executeJavaScript).not.toHaveBeenCalled()
    })

    await service.recordStart('session-a', tab, 'recording.webm')

    expect(executeJavaScript).toHaveBeenCalledOnce()
    await service.recordStop('session-a')
  })

  it('updates the state after closing a tab', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    await service.close('session-a', first)
    expect(service.state('session-a')).toEqual({
      tabs: [{ id: second, title: `Page ${second}` }]
    })
  })

  it('requests workbench selection only for popup tabs', () => {
    const send = vi.fn()
    const service = new BrowserService(
      { webContents: { send } } as unknown as import('electron').BrowserWindow,
      new ResourceManager()
    )

    const background = service.createTab('session-a', 'https://agent.example')
    expect(send).not.toHaveBeenCalled()

    h.managers[0].openTab('https://user.example')

    expect(send).toHaveBeenCalledWith('resource:select', {
      rendererId: 'browser',
      resourceId: background + 1,
      sessionId: 'session-a'
    })
    expect(send).toHaveBeenCalledOnce()
  })

  it('emits state changes with the owning session id', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const listener = vi.fn()
    service.bindChange(listener)
    service.createTab('session-a')
    const state = { tabs: [{ id: 1 }] } as BrowserState
    h.managers[0].emit(state)
    expect(listener).toHaveBeenCalledWith('session-a', state)
  })

  it('turns address-bar text into a search before navigating', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    expect(service.navigate('session-a', id, '小红书')).toBe(true)
    expect(h.managers[0].navigate).toHaveBeenCalledWith(
      id,
      'https://www.bing.com/search?q=%E5%B0%8F%E7%BA%A2%E4%B9%A6'
    )
  })

  it('removes every resource owned by a destroyed session', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    service.createTab('session-a')
    const other = service.createTab('session-b')
    await resources.destroy('session-a')
    expect(resources.list()).toEqual([{ id: other, type: 'browser', sessionId: 'session-b' }])
    expect(h.managers[0].destroy).toHaveBeenCalledOnce()
    expect(h.managers[1].destroy).not.toHaveBeenCalled()
  })

  it('rejects resources after global destruction starts', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    service.createTab('session-a')
    const destroying = service.destroy()
    expect(() => service.createTab('session-b')).toThrow()
    await destroying
    expect(() => service.createTab('session-b')).toThrow()
  })

  it('serializes recording globally', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    const firstTab = service.tab('session-a', first)!
    const secondTab = service.tab('session-b', second)!

    const generation = await service.recordStart('session-a', firstTab, 'first.webm')

    expect(generation).toBe(1)
    expect(h.managers[0].setRecording).toHaveBeenCalledWith(first)
    await expect(service.recordStart('session-b', secondTab, 'second.webm')).rejects.toThrow(
      'another browser recording is already in progress'
    )
    expect(h.managers[1].recordStart).not.toHaveBeenCalled()
    await expect(service.recordStop('session-b')).rejects.toThrow('no recording in progress')

    await service.recordStop('session-a')
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    await expect(service.recordStart('session-b', secondTab, 'second.webm')).resolves.toBe(1)
  })

  it('releases a stale recording claim after the recorder window crashes', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    h.managers[0].isRecording.mockReturnValue(false)

    await expect(
      service.recordStart('session-b', service.tab('session-b', second)!, 'second.webm')
    ).resolves.toBe(1)

    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("delete host.dataset.browserRendering"))
  })

  it('rejects a recording tab owned by another session without replacing the active claim', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    const firstTab = service.tab('session-a', first)!
    const foreignTab = service.tab('session-b', second)!
    await service.recordStart('session-a', firstTab, 'first.webm')

    await expect(service.recordRestart('session-a', foreignTab, 'second.webm')).rejects.toThrow(
      'browser tab not found'
    )
    await expect(service.recordStop('session-a')).resolves.toEqual({
      path: 'recording.webm',
      bytes: 1
    })
  })

  it('releases the global recording claim when startup fails', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    h.managers[0].recordStart.mockRejectedValueOnce(new Error('start failed'))

    await expect(
      service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    ).rejects.toThrow('start failed')
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    await expect(
      service.recordStart('session-b', service.tab('session-b', second)!, 'second.webm')
    ).resolves.toBe(1)
  })

  it('does not let an older stop clear a replacement recording', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    const tab = service.tab('session-a', id)!
    let finishStop!: (value: { path: string; bytes: number }) => void
    h.managers[0].recordStop.mockImplementationOnce(
      () => new Promise((resolve) => { finishStop = resolve })
    )

    await service.recordStart('session-a', tab, 'first.webm')
    const stopping = service.recordStop('session-a')
    await vi.waitFor(() => expect(finishStop).toBeTypeOf('function'))
    await expect(service.recordRestart('session-a', tab, 'second.webm')).resolves.toBe(2)

    finishStop({ path: 'first.webm', bytes: 1 })
    await stopping
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(id)
    await expect(service.recordStopIfCurrent('session-a', 2)).resolves.toEqual({
      path: 'recording.webm',
      bytes: 1
    })
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
  })

  it('moves the renderer lease when restarting a recording on another tab', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')

    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    await service.recordRestart('session-a', service.tab('session-a', second)!, 'second.webm')
    await service.recordStop('session-a')

    expect(executeJavaScript).toHaveBeenCalledTimes(4)
    expect(executeJavaScript.mock.calls.map(([script]) => script)).toEqual([
      expect.stringContaining(`[data-browser-webview-host=\\"${first}\\"]`),
      expect.stringContaining(`[data-browser-webview-host=\\"${second}\\"]`),
      expect.stringContaining(`[data-browser-webview-host=\\"${first}\\"]`),
      expect.stringContaining(`[data-browser-webview-host=\\"${second}\\"]`)
    ])
  })

  it('releases both renderer leases when a cross-tab recording restart fails', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    h.managers[0].recordRestart.mockRejectedValueOnce(new Error('restart failed'))

    await expect(
      service.recordRestart('session-a', service.tab('session-a', second)!, 'second.webm')
    ).rejects.toThrow('restart failed')

    expect(executeJavaScript).toHaveBeenCalledTimes(4)
    await expect(service.recordStop('session-a')).rejects.toThrow('no recording in progress')
  })

  it('preserves the previous recording when a restart target is not ready', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    const secondTab = service.tab('session-a', second)!
    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    vi.mocked(secondTab.ready).mockRejectedValueOnce(new Error('target is not ready'))

    await expect(service.recordRestart('session-a', secondTab, 'second.webm')).rejects.toThrow(
      'target is not ready'
    )

    expect(h.managers[0].recordRestart).not.toHaveBeenCalled()
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(first)
    await expect(service.recordStop('session-a')).resolves.toEqual({
      path: 'recording.webm',
      bytes: 1
    })
  })

  it('does not acquire a late renderer lease after a restarting tab closes', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const resources = new ResourceManager()
    const service = new BrowserService({ webContents: { executeJavaScript } } as never, resources)
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    let finishReady!: () => void
    vi.mocked(service.tab('session-a', second)!.ready).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishReady = resolve })
    )

    const restarting = service.recordRestart(
      'session-a',
      service.tab('session-a', second)!,
      'second.webm'
    )
    await vi.waitFor(() => expect(finishReady).toBeTypeOf('function'))
    await resources.close(second)
    finishReady()

    await expect(restarting).rejects.toThrow('recording was cancelled during startup')
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
    await expect(service.recordStop('session-a')).rejects.toThrow('no recording in progress')
  })

  it('cancels a pending cross-tab restart when the previous tab closes', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const resources = new ResourceManager()
    const service = new BrowserService({ webContents: { executeJavaScript } } as never, resources)
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    const secondTab = service.tab('session-a', second)!
    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    let finishReady!: () => void
    vi.mocked(secondTab.ready).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishReady = resolve })
    )

    const restarting = service.recordRestart('session-a', secondTab, 'second.webm')
    await vi.waitFor(() => expect(finishReady).toBeTypeOf('function'))
    await resources.close(first)
    finishReady()

    await expect(restarting).rejects.toThrow('recording was cancelled during startup')
    expect(h.managers[0].recordStop).toHaveBeenCalledOnce()
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
    await expect(service.recordStop('session-a')).rejects.toThrow('no recording in progress')
  })

  it('transfers one renderer lease across overlapping same-tab restarts', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const id = service.createTab('session-a')
    const tab = service.tab('session-a', id)!
    await service.recordStart('session-a', tab, 'first.webm')
    let finishFirstRestart!: (generation: number) => void
    h.managers[0].recordRestart
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirstRestart = resolve }))
      .mockResolvedValueOnce(3)

    const firstRestart = service.recordRestart('session-a', tab, 'second.webm')
    await vi.waitFor(() => expect(finishFirstRestart).toBeTypeOf('function'))
    await expect(service.recordRestart('session-a', tab, 'third.webm')).resolves.toBe(3)
    finishFirstRestart(2)

    await expect(firstRestart).rejects.toThrow('recording was cancelled during startup')
    await service.recordStop('session-a')
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('keeps inherited renderer leases during overlapping cross-tab restarts', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const service = new BrowserService(
      { webContents: { executeJavaScript } } as never,
      new ResourceManager()
    )
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    const third = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    let finishFirstRestart!: (generation: number) => void
    let finishSecondRestart!: (generation: number) => void
    h.managers[0].recordRestart
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirstRestart = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecondRestart = resolve }))

    const firstRestart = service.recordRestart(
      'session-a', service.tab('session-a', second)!, 'second.webm'
    )
    await vi.waitFor(() => expect(finishFirstRestart).toBeTypeOf('function'))
    const secondRestart = service.recordRestart(
      'session-a', service.tab('session-a', third)!, 'third.webm'
    )
    await vi.waitFor(() => expect(finishSecondRestart).toBeTypeOf('function'))
    expect(executeJavaScript).toHaveBeenCalledTimes(3)

    finishFirstRestart(2)
    await expect(firstRestart).rejects.toThrow('recording was cancelled during startup')
    expect(executeJavaScript).toHaveBeenCalledTimes(3)

    finishSecondRestart(3)
    await secondRestart
    await service.recordStop('session-a')
    expect(executeJavaScript).toHaveBeenCalledTimes(6)
  })

  it('reports cancellation when a resource closes during recording startup', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    const tab = service.tab('session-a', id)!
    let finishStart!: (generation: number) => void
    let finishStop!: (value: { path: string; bytes: number }) => void
    h.managers[0].recordStart.mockImplementationOnce(
      () => new Promise((resolve) => { finishStart = resolve })
    )
    h.managers[0].recordStop.mockImplementationOnce(
      () => new Promise((resolve) => { finishStop = resolve })
    )

    const starting = service.recordStart('session-a', tab, 'first.webm')
    await vi.waitFor(() => expect(finishStart).toBeTypeOf('function'))
    const closing = resources.close(id)
    await vi.waitFor(() => expect(finishStop).toBeTypeOf('function'))

    finishStart(1)
    await expect(starting).rejects.toThrow('recording was cancelled during startup')
    await expect(service.recordStart('session-b', tab, 'other.webm')).rejects.toThrow(
      'another browser recording is already in progress'
    )
    finishStop({ path: 'first.webm', bytes: 1 })
    await closing
  })

  it('stops and releases a recording when its resource closes', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')

    await resources.close(id)

    expect(h.managers[0].recordStopIfCurrent).toHaveBeenCalledWith(1)
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    await expect(service.recordStop('session-a')).rejects.toThrow('no recording in progress')
  })

  it('still closes a recorded tab when stopping the recording fails', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')
    h.managers[0].recordStopIfCurrent.mockRejectedValueOnce(new Error('recording write failed'))

    await expect(resources.close(id)).rejects.toThrow('recording write failed')

    expect(h.managers[0].close).toHaveBeenCalledWith(id)
    expect(service.tab('session-a', id)).toBeUndefined()
  })

  it('preserves both recording and tab close failures', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')
    h.managers[0].recordStopIfCurrent.mockRejectedValueOnce(new Error('recording write failed'))
    h.managers[0].close.mockRejectedValueOnce(new Error('tab close failed'))

    const error = await resources.close(id).catch((reason) => reason)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'recording write failed' }),
      expect.objectContaining({ message: 'tab close failed' })
    ])
  })

  it('destroys the session manager when recording cleanup fails', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')
    h.managers[0].recordStopIfCurrent.mockRejectedValueOnce(new Error('recording write failed'))

    await resources.destroy('session-a')

    expect(h.managers[0].close).toHaveBeenCalledWith(id)
    expect(h.managers[0].destroy).toHaveBeenCalledOnce()
  })
})
