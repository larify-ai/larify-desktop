/* eslint-disable @typescript-eslint/no-empty-function */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  hostWin: null as unknown,
  mainWin: null as unknown,
  containers: [] as Array<{
    boundsCalls: unknown[]
    children: unknown[]
    parent: unknown
  }>,
  views: [] as Array<{
    visibleCalls: boolean[]
    boundsCalls: unknown[]
    operations: string[]
    parent: unknown
  }>
}))

vi.mock('electron', () => {
  class View {
    boundsCalls: unknown[] = []
    children: unknown[] = []
    parent: unknown = null
    constructor() {
      h.containers.push(this)
    }
    addChildView(view: { parent: unknown }): void {
      this.children.push(view)
      view.parent = this
    }
    removeChildView(view: { parent: unknown }): void {
      this.children = this.children.filter((child) => child !== view)
      if (view.parent === this) view.parent = null
    }
    setBounds(bounds: unknown): void {
      this.boundsCalls.push(bounds)
    }
  }

  class FakeWebContents {
    url = 'about:blank'
    closed = false
    backgroundThrottlingCalls: boolean[] = []
    windowOpenHandler?: (details: { url: string }) => { action: string }
    on(): void {}
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
      this.windowOpenHandler = handler
    }
    loadURL(url: string): Promise<void> {
      this.url = url
      return Promise.resolve()
    }
    getURL(): string {
      return this.url
    }
    getTitle(): string {
      return ''
    }
    isLoading(): boolean {
      return false
    }
    reload(): void {}
    invalidate(): void {}
    setBackgroundThrottling(value: boolean): void {
      this.backgroundThrottlingCalls.push(value)
    }
    isDestroyed(): boolean {
      return this.closed
    }
    close(): void {
      this.closed = true
    }
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack(): void {},
      goForward(): void {}
    }
  }

  class WebContentsView {
    webContents = new FakeWebContents()
    visibleCalls: boolean[] = []
    boundsCalls: unknown[] = []
    operations: string[] = []
    parent: unknown = null
    constructor() {
      h.views.push(this)
    }
    setVisible(value: boolean): void {
      this.visibleCalls.push(value)
      this.operations.push(`visible:${value}`)
    }
    setBounds(bounds: unknown): void {
      this.boundsCalls.push(bounds)
      this.operations.push('bounds')
    }
  }

  class BrowserWindow {
    contentView = new View()
    constructor() {
      h.hostWin = this
    }
    setPosition(): void {}
    getContentBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 1280, height: 800 }
    }
    once(): void {}
    isDestroyed(): boolean {
      return false
    }
    destroy(): void {}
  }

  return { BrowserWindow, View, WebContentsView }
})

import { BrowserTabManager } from '../../../../src/extensions/browser/main/tab-manager'

function fakeWindow(): import('electron').BrowserWindow {
  const closedListeners = new Set<() => void>()
  const win = {
    once(_event: string, listener: () => void): void {
      closedListeners.add(listener)
    },
    removeListener(_event: string, listener: () => void): void {
      closedListeners.delete(listener)
    },
    listenerCount: () => closedListeners.size,
    isDestroyed: () => false,
    destroy(): void {},
    getContentBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    contentView: {
      children: [] as unknown[],
      addChildView(view: { parent: unknown }): void {
        this.children.push(view)
        view.parent = this
      },
      removeChildView(view: { parent: unknown }): void {
        this.children = this.children.filter((child) => child !== view)
        if (view.parent === this) view.parent = null
      }
    }
  }
  h.mainWin = win
  return win as unknown as import('electron').BrowserWindow
}

describe('BrowserTabManager', () => {
  beforeEach(() => {
    h.views.length = 0
    h.containers.length = 0
    h.hostWin = null
    h.mainWin = null
  })

  const parentOf = (view: { parent: unknown }): unknown => view.parent

  it('creates tabs in order and keeps them off-screen until visible bounds exist', () => {
    const manager = new BrowserTabManager(fakeWindow())
    expect(manager.createTab(1)).toBe(1)
    expect(manager.createTab(2)).toBe(2)
    expect(manager.state().activeId).toBe(2)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([1, 2])
    for (const view of h.views)
      expect(parentOf(view)).toBe((h.hostWin as { contentView: unknown }).contentView)
  })

  it('creates a background tab without changing the active tab', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.setVisible(true)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })

    manager.createTab(2, 'https://example.com', false)

    expect(manager.state().activeId).toBe(1)
    expect(parentOf(h.views[0])).toBe((h.mainWin as { contentView: unknown }).contentView)
    expect(parentOf(h.views[1])).toBe((h.hostWin as { contentView: unknown }).contentView)
  })

  it('exposes a requested URL immediately when creating a tab with a URL', () => {
    const manager = new BrowserTabManager(fakeWindow())
    expect(manager.createTab(1, 'example.com')).toBe(1)

    expect(manager.state().tabs[0]).toMatchObject({
      id: 1,
      url: 'https://example.com',
      loading: true
    })
  })

  it('emits state immediately when creating a tab with a URL', () => {
    const manager = new BrowserTabManager(fakeWindow())
    const changes: unknown[] = []
    manager.bindChange((state) => changes.push(state))

    manager.createTab(1, 'example.com')

    expect(changes.at(-1)).toMatchObject({
      activeId: 1,
      tabs: [{ id: 1, url: 'https://example.com' }]
    })
  })

  it('delegates popup tabs to the external resource owner', () => {
    const openTab = vi.fn()
    const manager = new BrowserTabManager(fakeWindow(), openTab)
    manager.createTab(1)

    const handler = (
      h.views[0] as unknown as {
        webContents: { windowOpenHandler: (details: { url: string }) => { action: string } }
      }
    ).webContents.windowOpenHandler

    expect(handler({ url: 'https://example.com/popup' })).toEqual({ action: 'deny' })
    expect(openTab).toHaveBeenCalledWith('https://example.com/popup')
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([1])
  })

  it('still denies a popup when its resource cannot be created', () => {
    const manager = new BrowserTabManager(fakeWindow(), () => {
      throw new Error('session is being destroyed')
    })
    manager.createTab(1)

    const handler = (
      h.views[0] as unknown as {
        webContents: { windowOpenHandler: (details: { url: string }) => { action: string } }
      }
    ).webContents.windowOpenHandler

    expect(handler({ url: 'https://example.com/popup' })).toEqual({ action: 'deny' })
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([1])
  })

  it('places only the active tab in the main window when visible', () => {
    const manager = new BrowserTabManager(fakeWindow())
    const first = manager.createTab(1)
    manager.createTab(2)
    manager.setVisible(true)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })

    const [firstView, secondView] = h.views
    expect(parentOf(secondView)).toBe((h.mainWin as { contentView: unknown }).contentView)
    expect(secondView.visibleCalls.at(-1)).toBe(true)
    expect(parentOf(firstView)).toBe((h.hostWin as { contentView: unknown }).contentView)
    expect(firstView.visibleCalls.at(-1)).toBe(false)

    manager.setActive(first)
    expect(parentOf(firstView)).toBe((h.mainWin as { contentView: unknown }).contentView)
    expect(firstView.visibleCalls.at(-1)).toBe(true)
    expect(parentOf(secondView)).toBe((h.hostWin as { contentView: unknown }).contentView)
    expect(secondView.visibleCalls.at(-1)).toBe(false)
  })

  it('restores a hidden view when moving it into the main window', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    const view = h.views[0]
    view.operations.length = 0

    manager.setVisible(true)

    expect(view.operations).toEqual(['bounds', 'visible:true'])
    expect(view.visibleCalls.at(-1)).toBe(true)
  })

  it('moves the active tab off-screen when the viewport collapses', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.setVisible(true)
    manager.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    expect(parentOf(h.views[0])).toBe((h.mainWin as { contentView: unknown }).contentView)

    manager.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    expect(parentOf(h.views[0])).toBe((h.hostWin as { contentView: unknown }).contentView)
    expect(h.views[0].visibleCalls.at(-1)).toBe(false)
  })

  it('does not lay out unchanged active, bounds, or visibility again', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    manager.setVisible(true)
    const view = h.views[0]
    view.boundsCalls.length = 0
    view.visibleCalls.length = 0

    manager.setActive(1)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    manager.setVisible(true)

    expect(view.boundsCalls).toEqual([])
    expect(view.visibleCalls).toEqual([])
  })

  it('updates only x and preserves the starting size during a live drag', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.createTab(2)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    manager.setVisible(true)
    const [hidden, active] = h.views
    const hideView = vi.spyOn(manager as unknown as { hideView(tab: unknown): void }, 'hideView')
    hidden.boundsCalls.length = 0
    hidden.visibleCalls.length = 0
    active.boundsCalls.length = 0
    active.visibleCalls.length = 0

    manager.setBounds({ x: 5, y: 25, width: 320, height: 210 }, true)
    manager.setBounds({ x: -80, y: 30, width: 400, height: 220 }, true)

    expect(hidden.boundsCalls).toEqual([])
    expect(hidden.visibleCalls).toEqual([])
    expect(active.boundsCalls).toEqual([
      { x: 5, y: 20, width: 300, height: 200 },
      { x: -80, y: 20, width: 300, height: 200 }
    ])
    expect(active.visibleCalls).toEqual([])
    expect(hideView).not.toHaveBeenCalled()
    expect(h.containers).toHaveLength(1)

    manager.setBounds({ x: -80, y: 30, width: 400, height: 220 })

    expect(active.boundsCalls.at(-1)).toEqual({ x: -80, y: 30, width: 400, height: 220 })
  })

  it('does not lay out the active view when closing an inactive tab', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const inactive = manager.createTab(1)
    manager.createTab(2)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    manager.setVisible(true)
    const active = h.views[1]
    active.boundsCalls.length = 0

    await manager.close(inactive)

    expect(active.boundsCalls).toEqual([])
  })

  it('keeps exactly the active view in the main window across layout transitions', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.createTab(2)
    manager.createTab(3)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    manager.setVisible(true)
    const mainIds = (): number[] =>
      h.views.flatMap((view, index) =>
        parentOf(view) === (h.mainWin as { contentView: unknown }).contentView ? [index + 1] : []
      )

    expect(mainIds()).toEqual([3])
    manager.setActive(1)
    expect(mainIds()).toEqual([1])
    await manager.close(2)
    expect(mainIds()).toEqual([1])
    manager.setVisible(false)
    expect(mainIds()).toEqual([])
    manager.setVisible(true)
    expect(mainIds()).toEqual([1])
    manager.setBounds({ x: 10, y: 20, width: 0, height: 200 })
    expect(mainIds()).toEqual([])
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    expect(mainIds()).toEqual([1])
    await manager.close(1)
    expect(mainIds()).toEqual([3])
  })

  it('keeps hidden tabs at a stable viewport without compositing them', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    const hidden = h.views[0]

    expect(hidden.boundsCalls.at(-1)).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
    expect(hidden.visibleCalls.at(-1)).toBe(false)
  })

  it('keeps a background recording visible without changing the active tab', () => {
    const manager = new BrowserTabManager(fakeWindow())
    const recording = manager.createTab(1)
    manager.createTab(2)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    manager.setVisible(true)

    manager.setRecording(recording)

    expect(manager.state().activeId).toBe(2)
    expect(parentOf(h.views[0])).toBe((h.hostWin as { contentView: unknown }).contentView)
    expect(h.views[0].visibleCalls.at(-1)).toBe(true)
    expect(parentOf(h.views[1])).toBe((h.mainWin as { contentView: unknown }).contentView)
    expect(h.views[1].visibleCalls.at(-1)).toBe(true)
    expect(
      (h.views[0] as unknown as { webContents: { backgroundThrottlingCalls: boolean[] } })
        .webContents.backgroundThrottlingCalls.at(-1)
    ).toBe(false)

    manager.setRecording(null)
    expect(manager.state().activeId).toBe(2)
    expect(h.views[0].visibleCalls.at(-1)).toBe(false)
    expect(
      (h.views[0] as unknown as { webContents: { backgroundThrottlingCalls: boolean[] } })
        .webContents.backgroundThrottlingCalls.at(-1)
    ).toBe(true)
  })

  it('restores background throttling only after the last agent operation finishes', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const webContents = (
      h.views[0] as unknown as { webContents: { backgroundThrottlingCalls: boolean[] } }
    ).webContents
    let releaseFirst!: () => void
    let releaseSecond!: () => void

    const first = manager.withUnthrottled(
      id,
      () => new Promise<void>((resolve) => { releaseFirst = resolve })
    )
    const second = manager.withUnthrottled(
      id,
      () => new Promise<void>((resolve) => { releaseSecond = resolve })
    )
    await vi.waitFor(() => expect(releaseSecond).toBeTypeOf('function'))
    expect(webContents.backgroundThrottlingCalls.at(-1)).toBe(false)

    releaseFirst()
    await first
    expect(webContents.backgroundThrottlingCalls.at(-1)).toBe(false)

    releaseSecond()
    await second
    expect(webContents.backgroundThrottlingCalls.at(-1)).toBe(true)
  })

  it('restores background throttling when an agent operation fails', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const webContents = (
      h.views[0] as unknown as { webContents: { backgroundThrottlingCalls: boolean[] } }
    ).webContents

    await expect(
      manager.withUnthrottled(id, async () => { throw new Error('operation failed') })
    ).rejects.toThrow('operation failed')

    expect(webContents.backgroundThrottlingCalls).toEqual([false, true])
  })

  it('keeps an off-screen tab rendered only while a render lease is active', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const view = h.views[0]
    let release!: () => void

    const operation = manager.withRendered(id, () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    )

    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(view.visibleCalls.at(-1)).toBe(true)
    release()
    await operation
    expect(view.visibleCalls.at(-1)).toBe(false)
  })

  it('restores visibility and throttling when a rendered operation fails', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const view = h.views[0]
    const webContents = (
      view as unknown as { webContents: { backgroundThrottlingCalls: boolean[] } }
    ).webContents

    await expect(
      manager.withRendered(id, async () => { throw new Error('capture failed') })
    ).rejects.toThrow('capture failed')

    expect(view.visibleCalls.at(-1)).toBe(false)
    expect(webContents.backgroundThrottlingCalls.at(-1)).toBe(true)
  })

  it('does not hide a tab that the user opens while a render lease is active', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })
    let release!: () => void

    const operation = manager.withRendered(id, () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    manager.setVisible(true)
    release()
    await operation

    expect(parentOf(h.views[0])).toBe((h.mainWin as { contentView: unknown }).contentView)
    expect(h.views[0].visibleCalls.at(-1)).toBe(true)
  })

  it('moves the active tab off-screen when the browser renderer is hidden', () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab(1)
    manager.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    manager.setVisible(true)
    expect(parentOf(h.views[0])).toBe((h.mainWin as { contentView: unknown }).contentView)

    manager.setVisible(false)
    expect(parentOf(h.views[0])).toBe((h.hostWin as { contentView: unknown }).contentView)
  })

  it('activates the neighbor when closing the active tab', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const a = manager.createTab(1)
    const b = manager.createTab(2)
    const c = manager.createTab(3)
    manager.setActive(b)
    await manager.close(b)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([a, c])
    expect(manager.state().activeId).toBe(c)
  })

  it('keeps temporary tabs out of UI state and destroys them after use', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const changes: unknown[] = []
    manager.bindChange((state) => changes.push(state))
    let temporaryTab: import('../../../../src/extensions/browser/main/tab').BrowserTab | undefined

    const value = await manager.withTemporaryTab('https://example.com', async (tab) => {
      temporaryTab = tab
      expect(tab.id).toBe(-1)
      expect(
        (tab.view.webContents as unknown as { backgroundThrottlingCalls: boolean[] })
          .backgroundThrottlingCalls
      ).toEqual([false])
      expect(manager.state()).toEqual({ tabs: [], activeId: null })
      expect((tab.view as unknown as { parent: unknown }).parent).toBeNull()
      return 42
    })

    expect(value).toBe(42)
    expect(changes).toEqual([])
    expect(temporaryTab?.view.webContents.close).toBeDefined()
    expect((temporaryTab?.view.webContents as unknown as { closed: boolean }).closed).toBe(true)
    expect(manager.createTab(1)).toBe(1)
  })

  it('rejects an invalid temporary-tab URL and still destroys the tab', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const callback = vi.fn(async () => undefined)

    await expect(manager.withTemporaryTab('not a valid url', callback)).rejects.toThrow(
      'invalid url'
    )

    expect(callback).not.toHaveBeenCalled()
    expect(
      (h.views.at(-1) as unknown as { webContents: { closed: boolean } }).webContents.closed
    ).toBe(true)
    expect(manager.state()).toEqual({ tabs: [], activeId: null })
  })

  it('destroys and rejects an in-flight temporary tab when the manager is destroyed', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    let callbackStarted!: () => void
    const started = new Promise<void>((resolve) => {
      callbackStarted = resolve
    })
    const operation = manager.withTemporaryTab('https://example.com', async () => {
      callbackStarted()
      await new Promise<void>(() => {})
    })
    await started
    const temporaryView = h.views[0] as {
      webContents: { closed: boolean }
    }

    await manager.destroy()

    await expect(operation).rejects.toThrow('browser tab manager was destroyed')
    expect(temporaryView.webContents.closed).toBe(true)
  })

  it('stops a recording before destroying its tab', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const stopIfRecordingTab = vi.fn(async () => undefined)
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = stopIfRecordingTab

    await manager.close(id)

    expect(stopIfRecordingTab).toHaveBeenCalledWith(id)
    expect(manager.state().tabs).toEqual([])
  })

  it('still closes a tab when stopping its recording fails', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const destroy = vi.spyOn(tab, 'destroy')
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = vi.fn(async () => {
      throw new Error('failed to write recording')
    })

    await expect(manager.close(id)).resolves.toBeUndefined()

    expect(destroy).toHaveBeenCalledOnce()
    expect(manager.state()).toEqual({ tabs: [], activeId: null })
  })

  it('coalesces concurrent closes of the same tab', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const destroy = vi.spyOn(tab, 'destroy')
    let finishStop!: () => void
    const stopIfRecordingTab = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve
        })
    )
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = stopIfRecordingTab

    const first = manager.close(id)
    const second = manager.close(id)
    finishStop()
    await Promise.all([first, second])

    expect(stopIfRecordingTab).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('waits for an in-progress close before destroying the manager', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const destroyTab = vi.spyOn(tab, 'destroy')
    let finishStop!: () => void
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = () =>
      new Promise<void>((resolve) => {
        finishStop = resolve
      })

    const closing = manager.close(id)
    const destroying = manager.destroy()
    await Promise.resolve()
    expect(destroyTab).not.toHaveBeenCalled()

    finishStop()
    await Promise.all([closing, destroying])
    expect(destroyTab).toHaveBeenCalledOnce()
  })

  it('makes destroy idempotent and rejects new tabs after teardown starts', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const destroyTab = vi.spyOn(tab, 'destroy')
    let finishRecorderDestroy!: () => void
    const destroyRecorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRecorderDestroy = resolve
        })
    )
    ;(manager as unknown as { recorder: { destroy: () => Promise<void> } }).recorder.destroy =
      destroyRecorder

    const first = manager.destroy()
    const second = manager.destroy()
    expect(second).toBe(first)
    expect(() => manager.createTab(2)).toThrow('browser tab manager is destroyed')
    expect(manager.close(id)).toBe(first)

    const windowOpen = (
      tab.view.webContents as unknown as {
        windowOpenHandler: (details: { url: string }) => { action: string }
      }
    ).windowOpenHandler
    expect(windowOpen({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(manager.state().tabs).toHaveLength(1)

    await vi.waitFor(() => expect(finishRecorderDestroy).toBeTypeOf('function'))
    finishRecorderDestroy()
    await first
    expect(destroyRecorder).toHaveBeenCalledOnce()
    expect(destroyTab).toHaveBeenCalledOnce()
  })

  it('removes its main-window closed listener when destroyed', async () => {
    const win = fakeWindow() as unknown as import('electron').BrowserWindow & {
      listenerCount(): number
    }
    const manager = new BrowserTabManager(win)
    expect(win.listenerCount()).toBe(1)

    await manager.destroy()

    expect(win.listenerCount()).toBe(0)
  })

  it('destroys tabs when recorder cleanup fails', async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const tab = manager.get(manager.createTab(1))!
    const destroyTab = vi.spyOn(tab, 'destroy')
    ;(manager as unknown as { recorder: { destroy: () => Promise<void> } }).recorder.destroy = () =>
      Promise.reject(new Error('recorder cleanup failed'))

    await expect(manager.destroy()).rejects.toThrow('recorder cleanup failed')
    expect(destroyTab).toHaveBeenCalledOnce()
    expect(manager.state().tabs).toEqual([])
  })
})
