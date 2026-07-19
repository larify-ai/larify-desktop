import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock("electron", () => {
  class FakeWebContents {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    url = ""
    title = "T"
    loading = false
    loadURLCalls: string[] = []

    on(event: string, cb: (...args: unknown[]) => void): void {
      ;(this.handlers[event] ??= []).push(cb)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) cb(...args)
    }

    loadURL(url: string): Promise<void> {
      this.url = url
      this.loadURLCalls.push(url)
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
} {
  return tab.view.webContents as unknown as {
    emit: (event: string, ...args: unknown[]) => void
    loadURLCalls: string[]
    loading: boolean
  }
}

describe("BrowserTab", () => {
  beforeEach(() => {
    h.fetchMock.mockReset()
  })

  it("normalizes navigation input before loading", async () => {
    const tab = new BrowserTab(1, "p")
    expect(tab.navigate("example.com")).toBe(true)
    await Promise.resolve()
    expect(webContents(tab).loadURLCalls).toContain("https://example.com")
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
