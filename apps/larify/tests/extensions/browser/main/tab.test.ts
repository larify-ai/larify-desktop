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
  setSavePath: (nextPath: string) => void
  once: (event: string, cb: (...args: unknown[]) => void) => void
  getSavePath: () => string
} {
  let savePath = path
  return {
    setSavePath: vi.fn((nextPath: string) => {
      savePath = nextPath
    }),
    once: vi.fn(),
    getSavePath: vi.fn(() => savePath),
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

    webContents(tab).session.emit("will-download", {}, downloadItem())
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
