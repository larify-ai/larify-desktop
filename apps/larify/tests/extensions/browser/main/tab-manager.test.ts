import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  hostWin: null as unknown,
  mainWin: null as unknown,
  views: [] as Array<{ visibleCalls: boolean[]; boundsCalls: unknown[]; parent: unknown }>,
}))

vi.mock("electron", () => {
  class FakeWebContents {
    url = "about:blank"
    on(): void {}
    setWindowOpenHandler(): void {}
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
  const win = {
    once(): void {},
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
    expect(firstView.visibleCalls.at(-1)).toBe(false)

    manager.setActive(first)
    expect(firstView.parent).toBe(h.mainWin)
    expect(firstView.visibleCalls.at(-1)).toBe(true)
    expect(secondView.parent).toBe(h.hostWin)
    expect(secondView.visibleCalls.at(-1)).toBe(false)
  })

  it("moves the active tab off-screen when the viewport collapses", () => {
    const manager = new BrowserTabManager(fakeWindow())
    manager.createTab()
    manager.setVisible(true)
    manager.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    expect(h.views[0].parent).toBe(h.mainWin)

    manager.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    expect(h.views[0].parent).toBe(h.hostWin)
    expect(h.views[0].visibleCalls.at(-1)).toBe(false)
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

  it("activates the neighbor when closing the active tab", () => {
    const manager = new BrowserTabManager(fakeWindow())
    const a = manager.createTab()
    const b = manager.createTab()
    const c = manager.createTab()
    manager.setActive(b)
    manager.close(b)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([a, c])
    expect(manager.state().activeId).toBe(c)
  })
})
