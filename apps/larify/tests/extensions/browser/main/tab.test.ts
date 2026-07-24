import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  clickMock: vi.fn(),
  sendCommandMock: vi.fn(),
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
    pendingLoads: Array<() => void> = []
    session = new FakeSession()
    debugger = {
      isAttached: () => true,
      attach: vi.fn(),
      on: vi.fn(),
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
          this.pendingLoads.push(() => {
            this.url = url
            this.emit("did-finish-load")
            this.emit("did-stop-loading")
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
      return this.url
    }

    getTitle(): string {
      return this.title
    }

    isLoading(): boolean {
      return this.loading
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
    setVisible(): void {}
    setBounds(): void {}
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
  pendingLoads: Array<() => void>
  session: {
    emit: (event: string, ...args: unknown[]) => void
  }
} {
  return tab.view.webContents as unknown as {
    emit: (event: string, ...args: unknown[]) => void
    loadURLCalls: string[]
    loading: boolean
    deferLoad: boolean
    pendingLoads: Array<() => void>
    session: {
      emit: (event: string, ...args: unknown[]) => void
    }
  }
}

function downloadItem(path = "D:\\Downloads\\file.txt"): {
  cancel: ReturnType<typeof vi.fn>
  setSavePath: (nextPath: string) => void
  once: (event: string, cb: (...args: unknown[]) => void) => void
  getSavePath: () => string
  triggerDone: (state: string) => void
} {
  let savePath = path
  let doneCb: ((event: unknown, state: string) => void) | undefined
  return {
    cancel: vi.fn(),
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
    h.clickMock.mockReset()
    h.sendCommandMock.mockReset()
    h.clickMock.mockResolvedValue(undefined)
    h.sendCommandMock.mockResolvedValue({})
  })

  it("normalizes navigation input before loading", async () => {
    const tab = new BrowserTab(1, "p")
    expect(tab.navigate("example.com")).toBe(true)
    await waitFor(() => expect(webContents(tab).loadURLCalls).toContain("https://example.com"))
  })

  it("exposes a pending navigation target before loadURL completes", async () => {
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true

    expect(tab.navigate("example.com")).toBe(true)
    await Promise.resolve()

    expect(tab.state().url).toBe("https://example.com")
    expect(tab.state().loading).toBe(true)

    await waitFor(() => expect(webContents(tab).pendingLoads.length).toBeGreaterThan(0))
    webContents(tab).pendingLoads.splice(0).forEach((resolve) => resolve())
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

    await expect(tab.download("a", "D:\\Downloads\\file.txt", 3000)).rejects.toThrow("selector not found")

    const session = tab.view.webContents.session as unknown as { handlers: Record<string, unknown[]> }
    expect(session.handlers["will-download"] ?? []).toHaveLength(0)
  })

  it("rejects and cleans up a pending download when destroyed", async () => {
    const tab = new BrowserTab(1, "p")
    const promise = tab.download("a", "D:\\Downloads\\file.txt", 3000)
    const session = tab.view.webContents.session as unknown as { handlers: Record<string, unknown[]> }
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

    messageHandler({}, "Network.loadingFinished", { requestId: "already-running" }, "OOPIF")
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).resolves.toBeUndefined()
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

  it("rejects a navigation whose loadURL promise never settles", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true

    const pending = tab.navigateAndWait("https://example.com")
    const assertion = expect(pending).rejects.toThrow("navigation load event timed out after 30s")
    await vi.advanceTimersByTimeAsync(30_000)

    await assertion
    vi.useRealTimers()
  })

  it("records a timeout instead of leaking an unhandled rejection from navigate", async () => {
    vi.useFakeTimers()
    const tab = new BrowserTab(1, "p")
    webContents(tab).deferLoad = true

    expect(tab.navigate("https://example.com")).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(tab.state().loading).toBe(false)
    expect(tab.state().error?.description).toContain("navigation load event timed out")
    vi.useRealTimers()
  })

  it("evaluates JavaScript functions and expressions", async () => {
    h.sendCommandMock.mockImplementation(async (method: string, params: { expression?: string }) => {
      if (method !== "Runtime.evaluate") return {}
      return { result: { value: await Function(`return ${params.expression}`)() } }
    })
    const tab = new BrowserTab(1, "p")

    await expect(tab.evalJs("() => 1 + 1")).resolves.toBe(2)
    await expect(tab.evalJs("async () => 1 + 1")).resolves.toBe(2)
    await expect(tab.evalJs("function () { return 1 + 1 }")).resolves.toBe(2)
    await expect(tab.evalJs("1 + 1")).resolves.toBe(2)
    await expect(tab.evalJs("missingGlobal")).rejects.toThrow("missingGlobal is not defined")
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
