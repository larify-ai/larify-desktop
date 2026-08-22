/* eslint-disable @typescript-eslint/no-empty-function */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  capturePageMock: vi.fn(),
  clickMock: vi.fn(),
  pressMock: vi.fn(),
  sendCommandMock: vi.fn(),
  viewOptions: [] as unknown[],
}))

vi.mock("electron", () => {
  class FakeSession {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {}

    on(event: string, cb: (...args: unknown[]) => void): void {
      ;(this.handlers[event] ??= []).push(cb)
    }

    once(event: string, cb: (...args: unknown[]) => void): void {
      const once = (...args: unknown[]): void => {
        this.off(event, once)
        cb(...args)
      }
      this.on(event, once)
    }

    off(event: string, cb: (...args: unknown[]) => void): void {
      this.handlers[event] = (this.handlers[event] ?? []).filter((handler) => handler !== cb)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) cb(...args)
    }
  }

  class FakeWebContents {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    url = ""
    title = "T"
    loading = false
    loadURLCalls: string[] = []
    deferLoad = false
    pendingLoads: Array<(emitEvents?: boolean) => void> = []
    destroyed = false
    session = new FakeSession()
    debugger = {
      isAttached: () => true,
      attach: vi.fn(),
      detach: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      sendCommand: (...args: unknown[]) => h.sendCommandMock(...args),
    }

    on(event: string, cb: (...args: unknown[]) => void): void {
      ;(this.handlers[event] ??= []).push(cb)
    }

    once(event: string, cb: (...args: unknown[]) => void): void {
      const once = (...args: unknown[]): void => {
        this.off(event, once)
        cb(...args)
      }
      this.on(event, once)
    }

    off(event: string, cb: (...args: unknown[]) => void): void {
      this.handlers[event] = (this.handlers[event] ?? []).filter((handler) => handler !== cb)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) cb(...args)
    }

    loadURL(url: string): Promise<void> {
      this.loadURLCalls.push(url)
      if (this.deferLoad) {
        return new Promise((resolve) => {
          this.pendingLoads.push((emitEvents = true) => {
            this.url = url
            if (emitEvents) {
              this.emit("did-finish-load")
              this.emit("did-stop-loading")
            }
            resolve()
          })
        })
      }
      this.url = url
      queueMicrotask(() => {
        this.emit("did-finish-load")
        this.emit("did-stop-loading")
      })
      return Promise.resolve()
    }

    getURL(): string {
      if (this.destroyed) throw new Error("Object has been destroyed")
      return this.url
    }

    getTitle(): string {
      return this.title
    }

    isLoading(): boolean {
      return this.loading
    }

    reload(): void {}
    close(): void {
      this.destroyed = true
      this.emit("destroyed")
    }

    isDestroyed(): boolean {
      return this.destroyed
    }
    capturePage(): Promise<unknown> {
      return h.capturePageMock()
    }
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack(): void {},
      goForward(): void {},
    }
  }

  class WebContentsView {
    webContents = new FakeWebContents()
    visible = true
    setVisible(visible: boolean): void {
      this.visible = visible
    }
    getVisible(): boolean {
      return this.visible
    }
    setBounds(): void {}
    constructor(options: unknown) {
      h.viewOptions.push(options)
    }
  }

  return {
    WebContentsView,
    net: {
      fetch: (...args: unknown[]) => h.fetchMock(...args),
    },
  }
})

vi.mock("../../../../src/extensions/browser/main/interactions", () => ({
  click: (...args: unknown[]) => h.clickMock(...args),
  press: (...args: unknown[]) => h.pressMock(...args),
}))

import { BrowserTab } from "../../../../src/extensions/browser/main/tab"

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw lastError
}

function webContents(tab: BrowserTab): {
  emit: (event: string, ...args: unknown[]) => void
  loadURLCalls: string[]
  loading: boolean
  deferLoad: boolean
  pendingLoads: Array<(emitEvents?: boolean) => void>
  session: {
    emit: (event: string, ...args: unknown[]) => void
  }
} {
  return tab.view.webContents as unknown as {
    emit: (event: string, ...args: unknown[]) => void
    loadURLCalls: string[]
    loading: boolean
    deferLoad: boolean
    pendingLoads: Array<(emitEvents?: boolean) => void>
    session: {
      emit: (event: string, ...args: unknown[]) => void
    }
  }
}

function downloadItem(
  path = "D:\\Downloads\\file.txt",
  finishOnCancel = true,
): {
  cancel: ReturnType<typeof vi.fn>
  setSavePath: (nextPath: string) => void
  once: (event: string, cb: (...args: unknown[]) => void) => void
  getSavePath: () => string
  triggerDone: (state: string) => void
} {
  let savePath = path
  let doneCb: ((event: unknown, state: string) => void) | undefined
  return {
    cancel: vi.fn(() => {
      if (finishOnCancel) queueMicrotask(() => doneCb?.({}, "cancelled"))
    }),
    setSavePath: vi.fn((nextPath: string) => {
      savePath = nextPath
    }),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "done") doneCb = cb as (event: unknown, state: string) => void
    }),
    getSavePath: vi.fn(() => savePath),
    triggerDone: (state: string) => doneCb?.({}, state),
  }
}

describe("BrowserTab", () => {
  beforeEach(() => {
    h.fetchMock.mockReset()
    h.capturePageMock.mockReset()
    h.clickMock.mockReset()
    h.pressMock.mockReset()
    h.sendCommandMock.mockReset()
    h.viewOptions.length = 0
    h.clickMock.mockResolvedValue(undefined)
    h.pressMock.mockResolvedValue(undefined)
    h.sendCommandMock.mockResolvedValue({})
  })

  it("enables background throttling for idle automation tabs", () => {
    new BrowserTab(1, "persist:test")

    expect(h.viewOptions).toContainEqual({
      webPreferences: { partition: "persist:test", backgroundThrottling: true },
    })
  })

  it("falls back to CDP when the display surface is unavailable", async () => {
    h.capturePageMock.mockRejectedValue(
      new Error("Current display surface not available for capture"),
    )
    h.sendCommandMock.mockImplementation(async (method: string) => {
      if (method === "Page.getLayoutMetrics") {
        return {
          cssVisualViewport: {
            pageX: 3,
            pageY: 5,
            clientWidth: 800,
            clientHeight: 600,
          },
        }
      }
      if (method === "Page.captureScreenshot") return { data: "cdp-image" }
      return {}
    })

    await expect(new BrowserTab(1, "p").screenshot({ format: "png" })).resolves.toEqual({
      data: "cdp-image",
      mimeType: "image/png",
    })
    expect(h.sendCommandMock).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        optimizeForSpeed: true,
        clip: { x: 3, y: 5, width: 800, height: 600, scale: 1 },
        captureBeyondViewport: false,
      },
      undefined,
    )
  })

  it("does not hide unrelated capturePage failures", async () => {
    h.capturePageMock.mockRejectedValue(new Error("renderer crashed"))

    await expect(new BrowserTab(1, "p").screenshot({ format: "png" })).rejects.toThrow(
      "renderer crashed",
    )
    expect(h.sendCommandMock).not.toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.anything(),
      expect.anything(),
    )
  })

  it("registers a CDP event listener synchronously", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    const dbg = tab.view.webContents.debugger as unknown as {
      on: ReturnType<typeof vi.fn>
    }
    dbg.on.mockClear()

    const pending = (
      tab as unknown as {
        waitForCdpEvent(method: string): Promise<unknown>
      }
    ).waitForCdpEvent("Input.dragIntercepted")

    expect(dbg.on).toHaveBeenCalledOnce()
    const listener = dbg.on.mock.calls[0][1] as (...args: unknown[]) => void
    listener({}, "Input.dragIntercepted", { data: "drag-data" })
    await expect(pending).resolves.toEqual({ data: "drag-data" })
  })

  it("normalizes navigation input before loading", async () => {
    const tab = new BrowserTab(1, "p")
    expect(tab.navigate("example.com")).toBe(true)
    await waitFor(() => expect(webContents(tab).loadURLCalls).toContain("https://example.com"))
  })

  it("skips browser automation for native previews", async () => {
    const tab = new BrowserTab(1, "p", { automation: false })
    const dbg = tab.view.webContents.debugger as unknown as {
      attach: ReturnType<typeof vi.fn>
    }

    expect(dbg.attach).not.toHaveBeenCalled()
    expect(webContents(tab).loadURLCalls).toEqual([])

    expect(tab.navigate("file:///D:/preview.pdf")).toBe(true)
    await waitFor(() => expect(webContents(tab).loadURLCalls).toContain("file:///D:/preview.pdf"))
  })

  it("exposes a pending navigation target before loadURL completes", async () => {
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true

    expect(tab.navigate("example.com")).toBe(true)
    await Promise.resolve()

    expect(tab.state().url).toBe("https://example.com")
    expect(tab.state().loading).toBe(true)

    await waitFor(() => expect(webContents(tab).pendingLoads.length).toBeGreaterThan(0))
    webContents(tab)
      .pendingLoads.splice(0)
      .forEach((resolve) => resolve())
    webContents(tab).emit("did-navigate")

    expect(tab.state().url).toBe("https://example.com")
    expect(tab.state().loading).toBe(false)
  })

  it("does not navigate invalid address text", async () => {
    const tab = new BrowserTab(1, "p")
    expect(tab.navigate("not a url")).toBe(false)
    await Promise.resolve()
    expect(webContents(tab).loadURLCalls).toEqual(["about:blank"])
  })

  it("ignores a delayed failure from an older navigation", () => {
    const tab = new BrowserTab(1, "p")
    expect(tab.navigate("https://new.example")).toBe(true)
    const pendingState = tab.state()

    webContents(tab).emit(
      "did-fail-load",
      {},
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "https://old.example",
      true,
    )

    expect(tab.state().url).toBe(pendingState.url)
    expect(tab.state().error).toBeNull()
  })

  it("keeps about:blank internal and exposes an empty tab state", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    expect(tab.state().url).toBe("")
    expect(tab.state().title).toBe("")
  })

  it("does not expose remote favicon urls before conversion", () => {
    const tab = new BrowserTab(1, "p")
    webContents(tab).emit("page-favicon-updated", {}, ["a.ico", "b.png"])
    expect(tab.state().favIconUrl).toBe("")
  })

  it("converts favicons to data urls in the main process", async () => {
    h.fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
      headers: { get: () => "image/png; charset=utf-8" },
    })
    const tab = new BrowserTab(1, "p")
    tab.navigate("https://x.com")
    await Promise.resolve()
    webContents(tab).emit("page-favicon-updated", {}, ["https://x.com/favicon.ico"])
    await waitFor(() => expect(tab.state().favIconUrl).toMatch(/^data:image\/png;base64,/))
  })

  it("clears favicon on cross-origin navigation and keeps it on same-origin navigation", async () => {
    const tab = new BrowserTab(1, "p")
    tab.navigate("https://a.com")
    await Promise.resolve()
    webContents(tab).emit("did-navigate")
    webContents(tab).emit("page-favicon-updated", {}, ["https://a.com/favicon.ico"])

    webContents(tab).emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "https://a.com/page",
    })
    expect(tab.state().favIconUrl).toBe("")

    webContents(tab).emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "https://b.com/",
    })
    expect(tab.state().favIconUrl).toBe("")
  })

  it("clears the previous favicon as soon as a cross-origin navigation starts", async () => {
    const tab = new BrowserTab(1, "p")
    tab.navigate("https://baidu.com")
    await Promise.resolve()
    webContents(tab).emit("did-navigate")
    webContents(tab).emit("page-favicon-updated", {}, ["https://baidu.com/favicon.ico"])
    expect(tab.state().favIconUrl).toBe("")

    webContents(tab).emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "https://www.xiaohongshu.com/explore",
    })
    expect(tab.state().favIconUrl).toBe("")
  })

  it("does not restore a stale favicon after cross-origin navigation starts", async () => {
    let resolveFetch!: (value: unknown) => void
    h.fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const tab = new BrowserTab(1, "p")
    tab.navigate("https://a.example")
    await Promise.resolve()
    webContents(tab).emit("did-navigate")
    webContents(tab).emit("page-favicon-updated", {}, ["https://a.example/favicon.ico"])

    webContents(tab).emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "https://b.example/",
    })
    resolveFetch({
      ok: true,
      arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
      headers: { get: () => "image/png" },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(tab.state().favIconUrl).toBe("")
  })

  it("does not access destroyed webContents when a favicon fetch finishes late", async () => {
    let finishFetch!: (value: unknown) => void
    h.fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishFetch = resolve
        }),
    )
    const tab = new BrowserTab(1, "p")
    webContents(tab).url = "https://example.com"
    const pending = (
      tab as unknown as {
        setFavIcon(favicons: string[]): Promise<void>
      }
    ).setFavIcon(["https://example.com/favicon.ico"])
    await vi.waitFor(() => expect(finishFetch).toBeTypeOf("function"))

    tab.destroy()
    finishFetch({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
      headers: { get: () => "image/png" },
    })

    await expect(pending).resolves.toBeUndefined()
  })

  it("marks loading as soon as main-frame navigation starts", () => {
    const tab = new BrowserTab(1, "p")
    expect(tab.state().loading).toBe(false)

    webContents(tab).loading = true
    webContents(tab).emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "https://example.com",
    })
    expect(tab.state().loading).toBe(true)

    webContents(tab).loading = false
    webContents(tab).emit("did-stop-loading")
    expect(tab.state().loading).toBe(false)
  })

  it("waits until webContents loading is stable before navigation returns", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    webContents(tab).loading = true

    let settled = false
    const promise = tab.navigateAndWait("https://example.com").then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    webContents(tab).emit("did-finish-load")
    await Promise.resolve()
    expect(settled).toBe(false)

    webContents(tab).loading = false
    webContents(tab).emit("did-stop-loading")
    await vi.advanceTimersByTimeAsync(99)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await promise
    expect(settled).toBe(true)
    expect(tab.state().loading).toBe(false)
    vi.useRealTimers()
  })

  it("reports when a download does not start before timeout", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const assertion = expect(promise).rejects.toThrow("download did not start within 3s")

    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    vi.useRealTimers()
  })

  it("reports when a download starts but does not finish before timeout", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const assertion = expect(promise).rejects.toThrow("download did not finish within 3s")
    const item = downloadItem()

    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)
    await vi.advanceTimersByTimeAsync(3000)

    await assertion
    expect(item.cancel).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it("resolves with the saved path when the download completes", async () => {
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const item = downloadItem()

    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)
    item.triggerDone("completed")

    await expect(promise).resolves.toBe("D:\\Downloads\\file.txt")
    expect(item.setSavePath).toHaveBeenCalledWith("D:\\Downloads\\file.txt")
  })

  it("rejects a concurrent download on the same tab instead of claiming the same item twice", async () => {
    const tab = new BrowserTab(1, "p")
    const first = tab.download("a", "D:\\Downloads\\first.txt", 3000)

    await expect(tab.download("b", "D:\\Downloads\\second.txt", 3000)).rejects.toThrow(
      "a download is already in progress",
    )

    const item = downloadItem()
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)
    item.triggerDone("completed")
    await expect(first).resolves.toBe("D:\\Downloads\\first.txt")
  })

  it("rejects when the download ends in a non-completed state", async () => {
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const item = downloadItem()

    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)
    item.triggerDone("cancelled")

    await expect(promise).rejects.toThrow("download failed: cancelled")
  })

  it("ignores will-download events initiated by other tabs on the shared session", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const assertion = expect(promise).rejects.toThrow("download did not start within 3s")
    const item = downloadItem()

    webContents(tab).session.emit("will-download", {}, item, { other: true })
    expect(item.setSavePath).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    vi.useRealTimers()
  })

  it("cleans up the will-download listener when the triggering click throws", async () => {
    const tab = new BrowserTab(1, "p")
    h.clickMock.mockRejectedValueOnce(new Error("selector not found"))

    await expect(tab.download("a", "D:\\Downloads\\file.txt", 3000)).rejects.toThrow(
      "selector not found",
    )

    const session = tab.view.webContents.session as unknown as {
      handlers: Record<string, unknown[]>
    }
    expect(session.handlers["will-download"] ?? []).toHaveLength(0)
  })

  it("rejects and cleans up a pending download when destroyed", async () => {
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const session = tab.view.webContents.session as unknown as {
      handlers: Record<string, unknown[]>
    }
    ;(tab.view.webContents.debugger as unknown as { detach: () => void }).detach = vi.fn()

    tab.destroy()

    await expect(promise).rejects.toThrow("tab was closed during download")
    expect(session.handlers["will-download"] ?? []).toHaveLength(0)
  })

  it("cancels an active download when destroyed", async () => {
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const item = downloadItem()
    ;(tab.view.webContents.debugger as unknown as { detach: () => void }).detach = vi.fn()
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)

    tab.destroy()

    await expect(promise).rejects.toThrow("tab was closed during download")
    expect(item.cancel).toHaveBeenCalledOnce()
  })

  it("cancels an active download when the operation is aborted", async () => {
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000, controller.signal)
    const item = downloadItem()
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)

    controller.abort()

    await expect(promise).rejects.toThrow("download was cancelled")
    expect(item.cancel).toHaveBeenCalledOnce()
  })

  it("cancels a download that starts after the operation was aborted", async () => {
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000, controller.signal)

    controller.abort()
    const item = downloadItem()
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)

    await expect(promise).rejects.toThrow("download was cancelled")
    expect(item.setSavePath).toHaveBeenCalledWith("D:\\Downloads\\file.txt")
    expect(item.cancel).toHaveBeenCalledOnce()
  })

  it("keeps the tab download slot occupied while awaiting a late cancelled download", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000, controller.signal)
    controller.abort()

    await expect(promise).rejects.toThrow("download was cancelled")
    await expect(tab.download("b", "D:\\Downloads\\second.txt", 3000)).rejects.toThrow(
      "a download is already in progress",
    )
    await vi.advanceTimersByTimeAsync(5000)
    const third = tab.download("c", "D:\\Downloads\\third.txt", 3000)
    const item = downloadItem("D:\\Downloads\\third.txt")
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)
    item.triggerDone("completed")
    await expect(third).resolves.toBe("D:\\Downloads\\third.txt")
    vi.useRealTimers()
  })

  it("cleans up when a late DownloadItem cannot be cancelled", async () => {
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000, controller.signal)
    controller.abort()
    const item = downloadItem()
    item.cancel.mockImplementation(() => {
      throw new Error("cancel exploded")
    })

    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)

    await expect(promise).rejects.toThrow("download was cancelled")
    const session = tab.view.webContents.session as unknown as {
      handlers: Record<string, unknown[]>
    }
    expect(session.handlers["will-download"] ?? []).toHaveLength(0)
  })

  it("waits for Electron to close an active download before reporting cancellation", async () => {
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000, controller.signal)
    const item = downloadItem("D:\\Downloads\\file.txt", false)
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)
    controller.abort()
    expect(item.cancel).toHaveBeenCalledOnce()
    const beforeDone = await Promise.race([
      promise.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 10)),
    ])
    expect(beforeDone).toBe("pending")

    item.triggerDone("cancelled")
    await expect(promise).rejects.toThrow("download was cancelled")
  })

  it("rejects cleanly when DownloadItem.cancel throws during tab destruction", async () => {
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const item = downloadItem("D:\\Downloads\\file.txt", false)
    item.cancel.mockImplementation(() => {
      throw new Error("cancel exploded")
    })
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)

    expect(() => tab.destroy()).not.toThrow()
    await expect(promise).rejects.toThrow(
      "tab was closed during download; failed to cancel download: cancel exploded",
    )
  })

  it("fails when Electron does not confirm download cancellation", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000, controller.signal)
    const item = downloadItem("D:\\Downloads\\file.txt", false)
    webContents(tab).session.emit("will-download", {}, item, tab.view.webContents)

    controller.abort()
    const assertion = expect(promise).rejects.toThrow(
      "download was cancelled; download cancellation was not confirmed within 5s",
    )
    await vi.advanceTimersByTimeAsync(5000)

    await assertion
    vi.useRealTimers()
  })

  it("does not report networkidle while a request seen before the wait is pending", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const dbg = tab.view.webContents.debugger as unknown as {
      off: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
    }
    dbg.off = vi.fn()
    const messageHandler = dbg.on.mock.calls.find((call) => call[0] === "message")?.[1]
    expect(messageHandler).toBeTypeOf("function")
    messageHandler({}, "Network.requestWillBeSent", { requestId: "already-running" })

    const promise = tab.waitForLoad("networkidle", 3000)
    let settled = false
    void promise.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(501)
    expect(settled).toBe(false)

    messageHandler({}, "Network.loadingFinished", { requestId: "already-running" })
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it("finishes a uniquely identified request across an auto-attach session transition", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const dbg = tab.view.webContents.debugger as unknown as {
      on: ReturnType<typeof vi.fn>
    }
    const messageHandler = dbg.on.mock.calls.find((call) => call[0] === "message")?.[1]
    expect(messageHandler).toBeTypeOf("function")
    messageHandler({}, "Network.requestWillBeSent", { requestId: "transitioning" })

    const pending = tab.waitForLoad("networkidle", 3000)
    messageHandler({}, "Network.loadingFinished", { requestId: "transitioning" }, "OOPIF")
    await vi.advanceTimersByTimeAsync(500)

    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it("tracks identical network request ids independently across CDP sessions", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const dbg = tab.view.webContents.debugger as unknown as {
      on: ReturnType<typeof vi.fn>
    }
    const messageHandler = dbg.on.mock.calls.find((call) => call[0] === "message")?.[1]
    expect(messageHandler).toBeTypeOf("function")
    messageHandler({}, "Network.requestWillBeSent", { requestId: "shared-id" })
    messageHandler({}, "Network.requestWillBeSent", { requestId: "shared-id" }, "OOPIF")

    const pending = tab.waitForLoad("networkidle", 3000)
    let settled = false
    void pending.then(() => {
      settled = true
    })

    messageHandler({}, "Network.loadingFinished", { requestId: "shared-id" }, "OOPIF")
    await vi.advanceTimersByTimeAsync(501)
    expect(settled).toBe(false)

    messageHandler({}, "Network.loadingFinished", { requestId: "shared-id" })
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it("forgets pending requests when an OOPIF target is detached", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const dbg = tab.view.webContents.debugger as unknown as {
      on: ReturnType<typeof vi.fn>
    }
    const messageHandler = dbg.on.mock.calls.find((call) => call[0] === "message")?.[1]
    expect(messageHandler).toBeTypeOf("function")
    messageHandler({}, "Network.requestWillBeSent", { requestId: "abandoned" }, "OOPIF")

    const pending = tab.waitForLoad("networkidle", 3000)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(501)
    expect(settled).toBe(false)

    messageHandler({}, "Target.detachedFromTarget", { sessionId: "OOPIF" })
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it("does not let an abandoned request from the previous page block networkidle", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const dbg = tab.view.webContents.debugger as unknown as {
      on: ReturnType<typeof vi.fn>
    }
    const messageHandler = dbg.on.mock.calls.find((call) => call[0] === "message")?.[1]
    messageHandler({}, "Network.requestWillBeSent", { requestId: "old-page-request" })

    webContents(tab).emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "https://example.com/new",
    })
    const pending = tab.waitForLoad("networkidle", 3000)
    await vi.advanceTimersByTimeAsync(500)

    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it("removes load listeners when waitForLoad times out", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    webContents(tab).loading = true
    const wc = tab.view.webContents as unknown as { handlers: Record<string, unknown[]> }

    const pending = tab.waitForLoad("load", 1000)
    const assertion = expect(pending).rejects.toThrow("wait_for_load load")
    expect(wc.handlers["did-finish-load"]).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)

    await assertion
    expect(wc.handlers["did-finish-load"] ?? []).toHaveLength(0)
    vi.useRealTimers()
  })

  it.each(["load", "domcontentloaded", "networkidle"] as const)(
    "rejects a pending %s wait promptly when the tab is destroyed",
    async (state) => {
      const tab = new BrowserTab(1, "p")
      await Promise.resolve()
      webContents(tab).loading = state !== "networkidle"

      const pending = tab.waitForLoad(state, 30_000)
      tab.destroy()

      await expect(pending).rejects.toThrow("tab was closed while waiting for load")
    },
  )

  it("rejects a navigation whose loadURL promise never settles", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true

    const pending = tab.navigateAndWait("https://example.com")
    const assertion = expect(pending).rejects.toThrow("navigation load event timed out after 60s")
    await vi.advanceTimersByTimeAsync(60_000)

    await assertion
    vi.useRealTimers()
  })

  it("accepts did-stop-loading when a native viewer omits did-finish-load", async () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true

    const pending = tab.navigateAndWait("file:///preview.pdf")
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))
    wc.emit("did-stop-loading")
    wc.pendingLoads[0](false)

    await expect(pending).resolves.toBeUndefined()
  })

  it("accepts did-navigate when a native viewer omits load completion events", async () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true

    const pending = tab.navigateAndWait("file:///preview.pdf")
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))
    wc.loading = false
    wc.pendingLoads[0](false)
    wc.emit("did-navigate", {}, "file:///preview.pdf", 200, "OK")

    await expect(pending).resolves.toBeUndefined()
  })

  it("rejects a pending navigation promptly when the tab is destroyed", async () => {
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true
    const pending = tab.navigateAndWait("https://example.com")
    await vi.waitFor(() => {
      expect(
        (webContents(tab) as unknown as { handlers: Record<string, unknown[]> }).handlers[
          "did-fail-load"
        ],
      ).toHaveLength(2)
    })

    tab.destroy()

    await expect(pending).rejects.toThrow("tab was closed during navigation")
  })

  it("rejects a navigation when the main frame fails to load", async () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true

    const pending = tab.navigateAndWait("https://missing.example")
    const assertion = expect(pending).rejects.toThrow("ERR_NAME_NOT_RESOLVED")
    await vi.waitFor(() => {
      expect(
        (wc as unknown as { handlers: Record<string, unknown[]> }).handlers["did-fail-load"],
      ).toHaveLength(2)
    })
    wc.loading = false
    wc.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://missing.example", true)

    await assertion
    expect(tab.state().error).toEqual({ code: -105, description: "ERR_NAME_NOT_RESOLVED" })
  })

  it("rejects a redirected navigation when the final URL fails to load", async () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true

    const pending = tab.navigateAndWait("https://redirect.example")
    const assertion = expect(pending).rejects.toThrow("ERR_NAME_NOT_RESOLVED")
    await vi.waitFor(() => {
      expect(
        (wc as unknown as { handlers: Record<string, unknown[]> }).handlers["did-fail-load"],
      ).toHaveLength(2)
    })
    wc.emit("did-start-navigation", {
      url: "https://final.example",
      isMainFrame: true,
      isSameDocument: false,
    })
    wc.loading = false
    wc.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://final.example", true)

    await assertion
    expect(tab.state().error).toEqual({ code: -105, description: "ERR_NAME_NOT_RESOLVED" })
  })

  it("records a failed history navigation to a different URL", () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.url = "https://current.example"
    wc.emit("did-navigate")
    const raw = wc as unknown as {
      navigationHistory: { canGoBack(): boolean; goBack(): void }
    }
    raw.navigationHistory.canGoBack = () => true
    raw.navigationHistory.goBack = () => {
      wc.emit("did-start-navigation", {
        url: "https://previous.example",
        isMainFrame: true,
        isSameDocument: false,
      })
    }

    tab.goBack()
    wc.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://previous.example", true)

    expect(tab.state().error).toEqual({ code: -105, description: "ERR_NAME_NOT_RESOLVED" })
  })

  it.each(["back", "forward", "reload"] as const)(
    "cleans load listeners when waiting %s throws synchronously",
    async (action) => {
      const tab = new BrowserTab(1, "p")
      await Promise.resolve()
      const wc = webContents(tab)
      const history = wc.navigationHistory as unknown as Record<string, unknown>
      if (action === "back") {
        history.canGoBack = () => true
        history.goBack = () => {
          throw new Error("navigation failed")
        }
      } else if (action === "forward") {
        history.canGoForward = () => true
        history.goForward = () => {
          throw new Error("navigation failed")
        }
      } else {
        ;(wc as unknown as { reload(): void }).reload = () => {
          throw new Error("navigation failed")
        }
      }

      const operation =
        action === "back"
          ? tab.goBackAndWait()
          : action === "forward"
            ? tab.goForwardAndWait()
            : tab.reloadAndWait()
      await expect(operation).rejects.toThrow("navigation failed")
      expect(wc.handlers["did-finish-load"] ?? []).toHaveLength(0)
    },
  )

  it("does not report an older navigation as successful after a newer navigation wins", async () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true

    const older = tab.navigateAndWait("https://older.example")
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))
    const newer = tab.navigateAndWait("https://newer.example")
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(2))

    wc.pendingLoads[1]()
    await expect(newer).resolves.toBeUndefined()
    wc.pendingLoads[0]()
    await expect(older).rejects.toThrow("navigation was superseded")
  })

  it("does not let a superseded fire-and-forget navigation overwrite newer state", async () => {
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true
    const changes: unknown[] = []
    tab.bindChange(() => changes.push(tab.state()))

    expect(tab.navigate("https://older.example")).toBe(true)
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))
    tab.reload()
    wc.emit("did-navigate")
    wc.pendingLoads[0]()
    await Promise.resolve()

    expect(tab.state().error).toBeNull()
    expect(changes.at(-1)).toMatchObject({ error: null })
  })

  it("does not let an older same-url navigation clear the newer pending state", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    const wc = webContents(tab)
    wc.deferLoad = true

    expect(tab.navigate("https://same.example")).toBe(true)
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))
    expect(tab.navigate("https://same.example")).toBe(true)
    await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(2))

    wc.pendingLoads[0]()
    await vi.advanceTimersByTimeAsync(101)

    expect(tab.state()).toMatchObject({
      url: "https://same.example",
      loading: true,
      error: null,
    })
    vi.useRealTimers()
  })

  it.each(["back", "forward", "reload"] as const)(
    "supersedes an older navigation when %s starts",
    async (action) => {
      const tab = new BrowserTab(1, "p")
      const wc = webContents(tab)
      wc.deferLoad = true
      const raw = wc as unknown as {
        navigationHistory: {
          canGoBack(): boolean
          canGoForward(): boolean
          goBack(): void
          goForward(): void
        }
        reload(): void
      }
      raw.navigationHistory.canGoBack = () => true
      raw.navigationHistory.canGoForward = () => true
      raw.navigationHistory.goBack = () => wc.emit("did-finish-load")
      raw.navigationHistory.goForward = () => wc.emit("did-finish-load")
      raw.reload = () => wc.emit("did-finish-load")

      const older = tab.navigateAndWait("https://older.example")
      const olderAssertion = expect(older).rejects.toThrow("navigation was superseded")
      await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))
      const newer =
        action === "back"
          ? tab.goBackAndWait()
          : action === "forward"
            ? tab.goForwardAndWait()
            : tab.reloadAndWait()
      wc.pendingLoads[0]()

      await expect(newer).resolves.toBeUndefined()
      await olderAssertion
    },
  )

  it.each(["back", "forward", "reload"] as const)(
    "supersedes an older navigation when non-waiting %s starts",
    async (action) => {
      const tab = new BrowserTab(1, "p")
      const wc = webContents(tab)
      wc.deferLoad = true
      const raw = wc as unknown as {
        navigationHistory: {
          canGoBack(): boolean
          canGoForward(): boolean
          goBack(): void
          goForward(): void
        }
        reload(): void
      }
      raw.navigationHistory.canGoBack = () => true
      raw.navigationHistory.canGoForward = () => true
      raw.navigationHistory.goBack = () => wc.emit("did-finish-load")
      raw.navigationHistory.goForward = () => wc.emit("did-finish-load")
      raw.reload = () => wc.emit("did-finish-load")

      const older = tab.navigateAndWait("https://older.example")
      const olderAssertion = expect(older).rejects.toThrow("navigation was superseded")
      await vi.waitFor(() => expect(wc.pendingLoads).toHaveLength(1))

      if (action === "back") tab.goBack()
      else if (action === "forward") tab.goForward()
      else tab.reload()
      wc.pendingLoads[0]()

      await olderAssertion
    },
  )

  it("records a timeout instead of leaking an unhandled rejection from navigate", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true

    expect(tab.navigate("https://example.com")).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(tab.state().loading).toBe(false)
    expect(tab.state().error?.description).toContain("navigation load event timed out")
    vi.useRealTimers()
  })

  it("evaluates JavaScript functions and expressions", async () => {
    h.sendCommandMock.mockImplementation(
      async (method: string, params: { expression?: string }) => {
        if (method !== "Runtime.evaluate") return {}
        return { result: { value: await Function(`return ${params.expression}`)() } }
      },
    )
    const tab = new BrowserTab(1, "p")

    await expect(tab.evalJs("() => 1 + 1")).resolves.toBe(2)
    await expect(tab.evalJs("async () => 1 + 1")).resolves.toBe(2)
    await expect(tab.evalJs("function () { return 1 + 1 }")).resolves.toBe(2)
    await expect(tab.evalJs("1 + 1")).resolves.toBe(2)
    await expect(tab.evalJs("missingGlobal")).rejects.toThrow("missingGlobal is not defined")
  })

  it("does not turn a read evaluation failure into an empty successful page", async () => {
    h.sendCommandMock.mockImplementation(async (method: string) => {
      if (method !== "Runtime.evaluate") return {}
      return {
        exceptionDetails: {
          text: "Uncaught",
          exception: { description: "Error: execution context was destroyed" },
        },
      }
    })
    const tab = new BrowserTab(1, "p")

    await expect(tab.read()).rejects.toThrow("execution context was destroyed")
  })

  it("waits for the document element before reading the page", async () => {
    const html = `<html><head><title>Ready</title></head><body><main><h1>Ready</h1><p>${"content ".repeat(80)}</p></main></body></html>`
    let documentReads = 0
    h.sendCommandMock.mockImplementation(
      async (method: string, params: { expression?: string }) => {
        if (method !== "Runtime.evaluate") return {}
        if (params.expression === "document.documentElement?.outerHTML ?? null") {
          documentReads += 1
          return { result: { value: documentReads === 1 ? null : html } }
        }
        if (params.expression === "!!(document.documentElement)") {
          return { result: { value: true } }
        }
        return {}
      },
    )
    const tab = new BrowserTab(1, "p")

    await expect(tab.read()).resolves.toMatchObject({ title: "Ready" })
    expect(documentReads).toBe(2)
  })

  it("stops waiting when the document element remains unavailable", async () => {
    vi.useFakeTimers()
    h.sendCommandMock.mockImplementation(
      async (method: string, params: { expression?: string }) => {
        if (method !== "Runtime.evaluate") return {}
        if (params.expression === "document.documentElement?.outerHTML ?? null") {
          return { result: { value: null } }
        }
        if (params.expression === "!!(document.documentElement)") {
          return { result: { value: false } }
        }
        return {}
      },
    )
    const tab = new BrowserTab(1, "p")
    const pending = tab.read()
    const rejection = expect(pending).rejects.toThrow("wait_for_function timed out after 5s")

    await vi.advanceTimersByTimeAsync(5000)
    await rejection
    vi.useRealTimers()
  })

  it("cancels a pending raw CDP call when the operation is aborted", async () => {
    h.sendCommandMock.mockImplementation(async (method: string) =>
      method === "Runtime.neverCompletes" ? new Promise<never>(() => {}) : {},
    )
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    const pending = tab.sendCdp("Runtime.neverCompletes", {}, undefined, 600_000, controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow("CDP command was cancelled: Runtime.neverCompletes")
    expect(
      h.sendCommandMock.mock.calls.some(([method]) => method === "Runtime.neverCompletes"),
    ).toBe(false)
  })

  it("does not send a raw CDP command when already aborted", async () => {
    const tab = new BrowserTab(1, "p")
    const controller = new AbortController()
    controller.abort()

    await expect(
      tab.sendCdp("Runtime.evaluate", {}, undefined, 600_000, controller.signal),
    ).rejects.toThrow("CDP command was cancelled: Runtime.evaluate")
    expect(h.sendCommandMock.mock.calls.some(([method]) => method === "Runtime.evaluate")).toBe(
      false,
    )
  })

  it("tracks a held modifier across raw keyboard down and up calls", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    h.sendCommandMock.mockClear()

    await tab.keyDown("Ctrl")
    await tab.keyDown("c")
    await tab.keyUp("c")
    await tab.keyUp("Ctrl")

    const keys = h.sendCommandMock.mock.calls
      .filter(([method]) => method === "Input.dispatchKeyEvent")
      .map(([, params]) => params)
    expect(keys).toMatchObject([
      { type: "keyDown", key: "Control", modifiers: 2 },
      { type: "keyDown", key: "c", modifiers: 2 },
      { type: "keyUp", key: "c", modifiers: 2 },
      { type: "keyUp", key: "Control", modifiers: 0 },
    ])
  })

  it("serializes concurrent raw keyboard calls so modifiers are preserved", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    h.sendCommandMock.mockClear()
    let releaseControl!: () => void
    const controlSent = new Promise<void>((resolve) => {
      releaseControl = resolve
    })
    h.sendCommandMock.mockImplementation(
      async (method: string, params: { key?: string; type?: string }) => {
        if (
          method === "Input.dispatchKeyEvent" &&
          params.type === "keyDown" &&
          params.key === "Control"
        ) {
          await controlSent
        }
        return {}
      },
    )

    const control = tab.keyDown("Ctrl")
    const letter = tab.keyDown("a")
    await Promise.resolve()
    releaseControl()
    await Promise.all([control, letter])

    const letterDown = h.sendCommandMock.mock.calls.find(
      ([method, params]) =>
        method === "Input.dispatchKeyEvent" &&
        (params as { key?: string; type?: string }).type === "keyDown" &&
        (params as { key?: string }).key === "a",
    )
    expect(letterDown?.[1]).toMatchObject({ modifiers: 2 })
  })

  it("serializes high-level and raw input operations", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    h.sendCommandMock.mockClear()
    let releaseClick!: () => void
    h.clickMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseClick = resolve
        }),
    )

    const click = tab.click("#button")
    const key = tab.keyDown("a")
    await Promise.resolve()
    expect(
      h.sendCommandMock.mock.calls.some(([method]) => method === "Input.dispatchKeyEvent"),
    ).toBe(false)
    releaseClick()
    await Promise.all([click, key])
    expect(h.sendCommandMock).toHaveBeenCalledWith(
      "Input.dispatchKeyEvent",
      expect.objectContaining({ key: "a", type: "keyDown" }),
      undefined,
    )
  })

  it("does not start queued input after the tab is destroyed", async () => {
    const tab = new BrowserTab(1, "p")
    let finishFirst!: () => void
    h.clickMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        }),
    )
    const first = tab.click("#first")
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"))
    const second = tab.click("#second")

    tab.destroy()
    finishFirst()

    await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toThrow("tab was closed before input")
    expect(h.clickMock).toHaveBeenCalledOnce()
  })

  it("destroys a tab only once", () => {
    const tab = new BrowserTab(1, "p")
    const dbg = tab.view.webContents.debugger as unknown as {
      detach: ReturnType<typeof vi.fn>
    }

    tab.destroy()
    tab.destroy()

    expect(dbg.detach).toHaveBeenCalledOnce()
  })

  it("passes concurrently pressed modifiers to high-level press", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    let releaseControl!: () => void
    const controlSent = new Promise<void>((resolve) => {
      releaseControl = resolve
    })
    h.sendCommandMock.mockImplementation(
      async (method: string, params: { key?: string; type?: string }) => {
        if (
          method === "Input.dispatchKeyEvent" &&
          params.type === "keyDown" &&
          params.key === "Control"
        ) {
          await controlSent
        }
        return {}
      },
    )

    const control = tab.keyDown("Control")
    const press = tab.press("a")
    await Promise.resolve()
    expect(h.pressMock).not.toHaveBeenCalled()
    releaseControl()
    await Promise.all([control, press])
    expect(h.pressMock).toHaveBeenCalledWith(expect.anything(), "a", 2)
  })

  it("does not retain a modifier whose keyDown command failed", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    h.sendCommandMock.mockClear()
    let failModifier = true
    h.sendCommandMock.mockImplementation(async (method: string) => {
      if (method === "Input.dispatchKeyEvent" && failModifier) {
        failModifier = false
        throw new Error("modifier down failed")
      }
      return {}
    })

    await expect(tab.keyDown("Ctrl")).rejects.toThrow("modifier down failed")
    await tab.keyDown("c")

    const cDown = h.sendCommandMock.mock.calls.find(
      ([method, params]) =>
        method === "Input.dispatchKeyEvent" &&
        (params as { type?: string; key?: string }).type === "keyDown" &&
        (params as { key?: string }).key === "c",
    )
    expect(cDown?.[1]).toMatchObject({ modifiers: 0 })
  })

  it("resets synthetic input state after the renderer process is replaced", async () => {
    const tab = new BrowserTab(1, "p")
    await Promise.resolve()
    h.sendCommandMock.mockClear()

    await tab.keyDown("Ctrl")
    await tab.mouseDown("left")
    webContents(tab).emit("render-process-gone", {}, { reason: "crashed" })
    h.sendCommandMock.mockClear()
    await tab.keyDown("c")
    await tab.mouseMove(10, 20)

    const keyDownCall = h.sendCommandMock.mock.calls.find(
      ([method, params]) =>
        method === "Input.dispatchKeyEvent" && (params as { type?: string }).type === "keyDown",
    )
    const mouseMoveCall = h.sendCommandMock.mock.calls.find(
      ([method, params]) =>
        method === "Input.dispatchMouseEvent" &&
        (params as { type?: string }).type === "mouseMoved",
    )
    expect(keyDownCall?.[1]).toMatchObject({ modifiers: 0 })
    expect(mouseMoveCall?.[1]).toMatchObject({ buttons: 0 })
  })

  it("ignores user abort and subframe load failures", () => {
    const tab = new BrowserTab(1, "p")
    webContents(tab).emit("did-fail-load", {}, -3, "aborted", "u", true)
    expect(tab.state().error).toBeNull()

    webContents(tab).emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "u", false)
    expect(tab.state().error).toBeNull()

    webContents(tab).emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "u", true)
    expect(tab.state().error).toEqual({ code: -105, description: "ERR_NAME_NOT_RESOLVED" })
  })
})
