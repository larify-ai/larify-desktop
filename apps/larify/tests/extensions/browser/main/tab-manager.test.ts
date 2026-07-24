import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  hostWin: null as unknown,
  mainWin: null as unknown,
  views: [] as Array<{ visibleCalls: boolean[]; boundsCalls: unknown[]; parent: unknown }>,
}))

vi.mock("electron", () => {
  class FakeWebContents {
    url = "about:blank"
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
      return ""
    }
    isLoading(): boolean {
      return false
    }
    reload(): void {}
    close(): void {}
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack(): void {},
      goForward(): void {},
    }
  }

  class WebContentsView {
    webContents = new FakeWebContents()
    visibleCalls: boolean[] = []
    boundsCalls: unknown[] = []
    parent: unknown = null
    constructor() {
      h.views.push(this)
    }
    setVisible(value: boolean): void {
      this.visibleCalls.push(value)
    }
    setBounds(bounds: unknown): void {
      this.boundsCalls.push(bounds)
    }
  }

  class BrowserWindow {
    contentView = {
      addChildView: (view: WebContentsView) => {
        view.parent = this
      },
      removeChildView: (view: WebContentsView) => {
        if (view.parent === this) view.parent = null
      },
    }
    constructor() {
      h.hostWin = this
    }
    setPosition(): void {}
    once(): void {}
    isDestroyed(): boolean {
      return false
    }
    destroy(): void {}
  }

  return { BrowserWindow, WebContentsView }
})

import { BrowserTabManager } from "../../../../src/extensions/browser/main/tab-manager"

function fakeWindow(): import("electron").BrowserWindow {
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
    contentView: {
      addChildView: (view: { parent: unknown }) => {
        view.parent = win
      },
      removeChildView: (view: { parent: unknown }) => {
        if (view.parent === win) view.parent = null
      },
    },
  }
  h.mainWin = win
  return win as unknown as import("electron").BrowserWindow
}

describe("BrowserTabManager", () => {
  beforeEach(() => {
    h.views.length = 0
    h.hostWin = null
    h.mainWin = null
  })

  it("creates tabs in order and keeps them off-screen until visible bounds exist", () => {
    const manager = new BrowserTabManager(fakeWindow())
    expect(manager.createTab()).toBe(1)
    expect(manager.createTab()).toBe(2)
    expect(manager.state().activeId).toBe(2)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([1, 2])
    for (const view of h.views) expect(view.parent).toBe(h.hostWin)
  })

  it("exposes a requested URL immediately when creating a tab with a URL", () => {
    const manager = new BrowserTabManager(fakeWindow())
    expect(manager.createTab("example.com")).toBe(1)

    expect(manager.state().tabs[0]).toMatchObject({
      id: 1,
      url: "https://example.com",
      loading: true,
    })
  })

  it("emits state immediately when creating a tab with a URL", () => {
    const manager = new BrowserTabManager(fakeWindow())
    const changes: unknown[] = []
    manager.bindChange((state) => changes.push(state))

    manager.createTab("example.com")

    expect(changes.at(-1)).toMatchObject({
      activeId: 1,
      tabs: [{ id: 1, url: "https://example.com" }],
    })
  })

  it("places only the active tab in the main window when visible", () => {
    const manager = new BrowserTabManager(fakeWindow())
    const first = manager.createTab()
    manager.createTab()
    manager.setVisible(true)
    manager.setBounds({ x: 10, y: 20, width: 300, height: 200 })

    const [firstView, secondView] = h.views
    expect(secondView.parent).toBe(h.mainWin)
    expect(secondView.visibleCalls.at(-1)).toBe(true)
    expect(firstView.parent).toBe(h.hostWin)
    expect(firstView.visibleCalls.at(-1)).toBe(true)

    manager.setActive(first)
    expect(firstView.parent).toBe(h.mainWin)
    expect(firstView.visibleCalls.at(-1)).toBe(true)
    expect(secondView.parent).toBe(h.hostWin)
    expect(secondView.visibleCalls.at(-1)).toBe(true)
  })

  it("moves the active tab off-screen when the viewport collapses", () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab()
    manager.setVisible(true)
    manager.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    expect(h.views[0].parent).toBe(h.mainWin)

    manager.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    expect(h.views[0].parent).toBe(h.hostWin)
    expect(h.views[0].visibleCalls.at(-1)).toBe(true)
  })

  it("reorders tabs and clamps the target index", () => {
    const manager = new BrowserTabManager(fakeWindow())
    const a = manager.createTab()
    const b = manager.createTab()
    const c = manager.createTab()
    manager.reorder(a, 20)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([b, c, a])
    manager.reorder(a, -1)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([a, b, c])
  })

  it("activates the neighbor when closing the active tab", async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const a = manager.createTab()
    const b = manager.createTab()
    const c = manager.createTab()
    manager.setActive(b)
    await manager.close(b)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([a, c])
    expect(manager.state().activeId).toBe(c)
  })

  it("stops a recording before destroying its tab", async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab()
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

  it("coalesces concurrent closes of the same tab", async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab()
    const tab = manager.get(id)!
    const destroy = vi.spyOn(tab, "destroy")
    let finishStop!: () => void
    const stopIfRecordingTab = vi.fn(
      () => new Promise<void>((resolve) => {
        finishStop = resolve
      }),
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

  it("waits for an in-progress close before destroying the manager", async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab()
    const tab = manager.get(id)!
    const destroyTab = vi.spyOn(tab, "destroy")
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

  it("makes destroy idempotent and rejects new tabs after teardown starts", async () => {
    const manager = new BrowserTabManager(fakeWindow())
    const id = manager.createTab()
    const tab = manager.get(id)!
    const destroyTab = vi.spyOn(tab, "destroy")
    let finishRecorderDestroy!: () => void
    const destroyRecorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRecorderDestroy = resolve
        }),
    )
    ;(manager as unknown as { recorder: { destroy: () => Promise<void> } }).recorder.destroy =
      destroyRecorder

    const first = manager.destroy()
    const second = manager.destroy()
    expect(second).toBe(first)
    expect(() => manager.createTab()).toThrow("browser tab manager is destroyed")
    expect(manager.close(id)).toBe(first)

    const windowOpen = (
      tab.view.webContents as unknown as {
        windowOpenHandler: (details: { url: string }) => { action: string }
      }
    ).windowOpenHandler
    expect(windowOpen({ url: "https://example.com" })).toEqual({ action: "deny" })
    expect(manager.state().tabs).toHaveLength(1)

    await vi.waitFor(() => expect(finishRecorderDestroy).toBeTypeOf("function"))
    finishRecorderDestroy()
    await first
    expect(destroyRecorder).toHaveBeenCalledOnce()
    expect(destroyTab).toHaveBeenCalledOnce()
  })

  it("removes its main-window closed listener when destroyed", async () => {
    const win = fakeWindow() as unknown as import("electron").BrowserWindow & { listenerCount(): number }
    const manager = new BrowserTabManager(win)
    expect(win.listenerCount()).toBe(1)

    await manager.destroy()

    expect(win.listenerCount()).toBe(0)
  })
})
