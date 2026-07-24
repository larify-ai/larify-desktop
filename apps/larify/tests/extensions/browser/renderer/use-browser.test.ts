// @vitest-environment jsdom

import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useBrowser } from "../../../../src/extensions/browser/renderer/use-browser"
import type { BrowserState } from "../../../../src/extensions/browser/shared/types"
import { setAgentSessionId } from "../../../../src/renderer/src/lib/agent-session"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type BrowserHook = ReturnType<typeof useBrowser>

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function Probe({
  onBrowser,
  onState,
}: {
  onBrowser?: (browser: BrowserHook) => void
  onState: (state: BrowserState) => void
}): null {
  const browser = useBrowser()
  onState(browser.state)
  onBrowser?.(browser)
  return null
}

describe("useBrowser", () => {
  let container: HTMLDivElement
  let root: Root
  let listeners: Array<(value: unknown) => void>
  let invoke: ReturnType<typeof vi.fn>
  let stateRequest: Deferred<unknown>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    listeners = []
    stateRequest = deferred()
    invoke = vi.fn((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      return Promise.resolve(undefined)
    })
    Object.defineProperty(window, "bridge", {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((_channel: string, callback: (value: unknown) => void) => {
          listeners.push(callback)
          return () => {
            listeners = listeners.filter((listener) => listener !== callback)
          }
        }),
      },
    })
    setAgentSessionId("session-a")
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("loads without creating tabs until the browser workbench is visible", async () => {
    await act(async () => root.render(createElement(Probe, { onState: vi.fn() })))

    expect(invoke).toHaveBeenCalledWith("browser:getState", "session-a")
    expect(invoke).not.toHaveBeenCalledWith("browser:ensureTab", "session-a")

    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })

    expect(invoke).not.toHaveBeenCalledWith("browser:ensureTab", "session-a")

    await act(async () => {
      stateRequest.resolve({ tabs: [], activeId: null })
    })

    expect(invoke).toHaveBeenCalledWith("browser:ensureTab", "session-a")
  })

  it("closes the workbench instead of recreating a tab when the last tab closes", async () => {
    let browser: BrowserHook | undefined
    const closeEvents: Array<string | null> = []
    const onCloseWorkbench = (event: Event): void => {
      closeEvents.push((event as CustomEvent<string | null>).detail)
    }
    window.addEventListener("larify:workbench-close", onCloseWorkbench)

    await act(async () =>
      root.render(
        createElement(Probe, {
          onBrowser: (value) => {
            browser = value
          },
          onState: vi.fn(),
        }),
      ),
    )
    await act(async () => {
      stateRequest.resolve({ tabs: [], activeId: null })
    })

    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
      listeners[0]({
        sessionId: "session-a",
        state: { tabs: [{ id: 1, title: "only" }], activeId: 1 },
      })
    })

    invoke.mockClear()

    await act(async () => {
      await browser?.close(1)
    })

    await act(async () => {
      listeners[0]({ sessionId: "session-a", state: { tabs: [], activeId: null } })
    })

    expect(invoke).toHaveBeenCalledWith("browser:close", "session-a", 1)
    expect(closeEvents).toEqual(["browser"])
    expect(invoke.mock.calls.filter((call) => call[0] === "browser:ensureTab")).toHaveLength(0)
    window.removeEventListener("larify:workbench-close", onCloseWorkbench)
  })

  it("does not close the workbench when another tab appears during the close", async () => {
    let browser: BrowserHook | undefined
    const closeRequest = deferred<unknown>()
    const closeEvents: Array<string | null> = []
    const onCloseWorkbench = (event: Event): void => {
      closeEvents.push((event as CustomEvent<string | null>).detail)
    }
    window.addEventListener("larify:workbench-close", onCloseWorkbench)
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:close") return closeRequest.promise
      return Promise.resolve(undefined)
    })

    await act(async () =>
      root.render(
        createElement(Probe, {
          onBrowser: (value) => {
            browser = value
          },
          onState: vi.fn(),
        }),
      ),
    )
    await act(async () => {
      stateRequest.resolve({
        tabs: [{ id: 1, title: "only" }],
        activeId: 1,
      })
    })

    let closing!: Promise<void>
    await act(async () => {
      closing = browser!.close(1)
      listeners[0]({
        sessionId: "session-a",
        state: { tabs: [{ id: 2, title: "new" }], activeId: 2 },
      })
      closeRequest.resolve({ tabs: [{ id: 2, title: "new" }], activeId: 2 })
      await closing
    })

    expect(closeEvents).toEqual([])
    window.removeEventListener("larify:workbench-close", onCloseWorkbench)
  })

  it("closes the workbench when all remaining tabs are closed concurrently", async () => {
    let browser: BrowserHook | undefined
    const closeEvents: Array<string | null> = []
    const onCloseWorkbench = (event: Event): void => {
      closeEvents.push((event as CustomEvent<string | null>).detail)
    }
    window.addEventListener("larify:workbench-close", onCloseWorkbench)
    invoke.mockImplementation((channel: string, _sessionId: string, id?: number) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:close") {
        return Promise.resolve(
          id === 1
            ? { tabs: [{ id: 2, title: "two" }], activeId: 2 }
            : { tabs: [], activeId: null },
        )
      }
      return Promise.resolve(undefined)
    })

    await act(async () =>
      root.render(
        createElement(Probe, {
          onBrowser: (value) => {
            browser = value
          },
          onState: vi.fn(),
        }),
      ),
    )
    await act(async () => {
      stateRequest.resolve({
        tabs: [{ id: 1, title: "one" }, { id: 2, title: "two" }],
        activeId: 1,
      })
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })

    await act(async () => {
      await Promise.all([browser!.close(1), browser!.close(2)])
    })

    expect(closeEvents).toEqual(["browser"])
    expect(invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab")).toHaveLength(0)
    window.removeEventListener("larify:workbench-close", onCloseWorkbench)
  })

  it("keeps the workbench open when a new tab appears during concurrent closes", async () => {
    let browser: BrowserHook | undefined
    const closeEvents: Array<string | null> = []
    const onCloseWorkbench = (event: Event): void => {
      closeEvents.push((event as CustomEvent<string | null>).detail)
    }
    window.addEventListener("larify:workbench-close", onCloseWorkbench)
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:close") return Promise.resolve({ tabs: [], activeId: null })
      return Promise.resolve(undefined)
    })

    await act(async () =>
      root.render(
        createElement(Probe, {
          onBrowser: (value) => {
            browser = value
          },
          onState: vi.fn(),
        }),
      ),
    )
    await act(async () => {
      stateRequest.resolve({
        tabs: [{ id: 1, title: "one" }, { id: 2, title: "two" }],
        activeId: 1,
      })
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })
    await act(async () => {
      const closing = Promise.all([browser!.close(1), browser!.close(2)])
      listeners[0]({
        sessionId: "session-a",
        state: { tabs: [{ id: 3, title: "new" }], activeId: 3 },
      })
      await closing
    })

    expect(closeEvents).toEqual([])
    window.removeEventListener("larify:workbench-close", onCloseWorkbench)
  })

  it("restores auto-create suppression when a close fails", async () => {
    let browser: BrowserHook | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:close") return Promise.reject(new Error("close failed"))
      return Promise.resolve(undefined)
    })
    await act(async () =>
      root.render(
        createElement(Probe, {
          onBrowser: (value) => {
            browser = value
          },
          onState: vi.fn(),
        }),
      ),
    )
    await act(async () => {
      stateRequest.resolve({ tabs: [{ id: 1, title: "one" }], activeId: 1 })
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })

    await expect(browser!.close(1)).rejects.toThrow("close failed")
    await act(async () => {
      listeners[0]({ sessionId: "session-a", state: { tabs: [], activeId: null } })
    })

    expect(invoke).toHaveBeenCalledWith("browser:ensureTab", "session-a")
  })

  it("ignores state events for other sessions", async () => {
    const onState = vi.fn()
    await act(async () => root.render(createElement(Probe, { onState })))
    await act(async () => {
      stateRequest.resolve({ tabs: [], activeId: null })
    })

    await act(async () => {
      listeners[0]({
        sessionId: "session-b",
        state: { tabs: [{ id: 2, title: "other" }], activeId: 2 },
      })
    })
    expect(onState).not.toHaveBeenLastCalledWith({ tabs: [{ id: 2, title: "other" }], activeId: 2 })

    const ownState = { tabs: [{ id: 1, title: "own" }], activeId: 1 } as BrowserState
    await act(async () => {
      listeners[0]({ sessionId: "session-a", state: ownState })
    })
    expect(onState).toHaveBeenLastCalledWith(ownState)
  })

  it("does not let an older getState response overwrite a newer state event", async () => {
    const onState = vi.fn()
    await act(async () => root.render(createElement(Probe, { onState })))
    const freshState = {
      tabs: [{ id: 2, title: "fresh" }],
      activeId: 2,
    } as BrowserState

    await act(async () => {
      listeners[0]({ sessionId: "session-a", state: freshState })
      stateRequest.resolve({ tabs: [], activeId: null })
    })

    expect(onState).toHaveBeenLastCalledWith(freshState)
  })

  it("recovers from a failed initial state request through a later state event", async () => {
    const onState = vi.fn()
    await act(async () => root.render(createElement(Probe, { onState })))
    await act(async () => {
      stateRequest.reject(new Error("IPC unavailable"))
      await Promise.resolve()
    })
    const recovered = {
      tabs: [{ id: 3, title: "recovered" }],
      activeId: 3,
    } as BrowserState

    await act(async () => {
      listeners[0]({ sessionId: "session-a", state: recovered })
    })

    expect(onState).toHaveBeenLastCalledWith(recovered)
  })

  it("retries state loading after the initial and visible requests both fail", async () => {
    vi.useFakeTimers()
    let available = false
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") {
        return available
          ? Promise.resolve({ tabs: [], activeId: null })
          : Promise.reject(new Error("IPC unavailable"))
      }
      return Promise.resolve(undefined)
    })
    await act(async () => root.render(createElement(Probe, { onState: vi.fn() })))
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
      await Promise.resolve()
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === "browser:getState")).toHaveLength(2)
    expect(invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab")).toHaveLength(0)

    available = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(invoke.mock.calls.filter(([channel]) => channel === "browser:getState")).toHaveLength(3)
    expect(invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab")).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === "browser:getState")).toHaveLength(3)
    vi.useRealTimers()
  })

  it("applies an older successful request when a newer refresh fails", async () => {
    const refreshRequest = deferred<unknown>()
    let getStateCalls = 0
    invoke.mockImplementation((channel: string) => {
      if (channel !== "browser:getState") return Promise.resolve(undefined)
      return ++getStateCalls === 1 ? stateRequest.promise : refreshRequest.promise
    })
    const onState = vi.fn()
    await act(async () => root.render(createElement(Probe, { onState })))
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })
    const olderSuccess = {
      tabs: [{ id: 7, title: "older success" }],
      activeId: 7,
    } as BrowserState

    await act(async () => {
      refreshRequest.reject(new Error("refresh failed"))
      stateRequest.resolve(olderSuccess)
      await Promise.resolve()
    })

    expect(onState).toHaveBeenLastCalledWith(olderSuccess)
  })

  it("retries ensureTab twice after transient failures", async () => {
    vi.useFakeTimers()
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:ensureTab") return Promise.reject(new Error("ensure failed"))
      return Promise.resolve(undefined)
    })
    await act(async () => root.render(createElement(Probe, { onState: vi.fn() })))
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
      stateRequest.resolve({ tabs: [], activeId: null })
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(
      invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab"),
    ).toHaveLength(3)
    vi.useRealTimers()
  })

  it("keeps retrying ensureTab with bounded backoff until the service recovers", async () => {
    vi.useFakeTimers()
    let available = false
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:ensureTab") {
        return available ? Promise.resolve(undefined) : Promise.reject(new Error("ensure failed"))
      }
      return Promise.resolve(undefined)
    })
    await act(async () => root.render(createElement(Probe, { onState: vi.fn() })))
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
      stateRequest.resolve({ tabs: [], activeId: null })
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab"),
    ).toHaveLength(4)

    available = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab"),
    ).toHaveLength(5)
    vi.useRealTimers()
  })

  it("does not let an old session success reset the current session retry backoff", async () => {
    vi.useFakeTimers()
    const oldEnsure = deferred<unknown>()
    const stateRequests = new Map<string, Deferred<unknown>>()
    let sessionBEnsureCalls = 0
    invoke.mockImplementation((channel: string, requestedSessionId: string) => {
      if (channel === "browser:getState") {
        const request = deferred<unknown>()
        stateRequests.set(requestedSessionId, request)
        return request.promise
      }
      if (channel === "browser:ensureTab") {
        if (requestedSessionId === "session-a") return oldEnsure.promise
        sessionBEnsureCalls++
        return Promise.reject(new Error("ensure failed"))
      }
      return Promise.resolve(undefined)
    })
    await act(async () => root.render(createElement(Probe, { onState: vi.fn() })))
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
      stateRequests.get("session-a")!.resolve({ tabs: [], activeId: null })
    })
    await act(async () => {
      setAgentSessionId("session-b")
    })
    await act(async () => {
      stateRequests.get("session-b")!.resolve({ tabs: [], activeId: null })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(sessionBEnsureCalls).toBe(2)

    await act(async () => {
      oldEnsure.resolve(undefined)
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(sessionBEnsureCalls).toBe(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(sessionBEnsureCalls).toBe(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })
    expect(sessionBEnsureCalls).toBe(4)
    vi.useRealTimers()
  })

  it("cancels a scheduled ensureTab retry when the hook unmounts", async () => {
    vi.useFakeTimers()
    invoke.mockImplementation((channel: string) => {
      if (channel === "browser:getState") return stateRequest.promise
      if (channel === "browser:ensureTab") return Promise.reject(new Error("ensure failed"))
      return Promise.resolve(undefined)
    })
    await act(async () => root.render(createElement(Probe, { onState: vi.fn() })))
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
      stateRequest.resolve({ tabs: [], activeId: null })
      await Promise.resolve()
    })
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab"),
    ).toHaveLength(1)

    await act(async () => root.unmount())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "browser:ensureTab"),
    ).toHaveLength(1)
    vi.useRealTimers()
  })

  it("does not let an old session refresh overwrite the current session", async () => {
    const requests = new Map<string, Array<Deferred<unknown>>>()
    invoke.mockImplementation((channel: string, requestedSessionId: string) => {
      if (channel !== "browser:getState") return Promise.resolve(undefined)
      const request = deferred<unknown>()
      const list = requests.get(requestedSessionId) ?? []
      list.push(request)
      requests.set(requestedSessionId, list)
      return request.promise
    })
    const onState = vi.fn()
    await act(async () => root.render(createElement(Probe, { onState })))
    await act(async () => {
      requests.get("session-a")![0].resolve({ tabs: [], activeId: null })
    })
    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })
    expect(requests.get("session-a")).toHaveLength(2)

    await act(async () => {
      setAgentSessionId("session-b")
    })
    const sessionBRequests = requests.get("session-b") ?? []
    expect(sessionBRequests.length).toBeGreaterThan(0)
    const sessionBState = {
      tabs: [{ id: 2, title: "session-b" }],
      activeId: 2,
    } as BrowserState
    await act(async () => {
      for (const request of sessionBRequests) request.resolve(sessionBState)
    })
    await act(async () => {
      requests.get("session-a")![1].resolve({
        tabs: [{ id: 1, title: "stale-session-a" }],
        activeId: 1,
      })
    })

    expect(onState).toHaveBeenLastCalledWith(sessionBState)
  })

  it("does not close the current workbench when an old session close resolves late", async () => {
    const stateRequests = new Map<string, Deferred<unknown>>()
    const oldClose = deferred<unknown>()
    const closeEvents: Array<string | null> = []
    let browser: BrowserHook | undefined
    const onCloseWorkbench = (event: Event): void => {
      closeEvents.push((event as CustomEvent<string | null>).detail)
    }
    window.addEventListener("larify:workbench-close", onCloseWorkbench)
    invoke.mockImplementation((channel: string, requestedSessionId: string) => {
      if (channel === "browser:getState") {
        const request = deferred<unknown>()
        stateRequests.set(requestedSessionId, request)
        return request.promise
      }
      if (channel === "browser:close" && requestedSessionId === "session-a") {
        return oldClose.promise
      }
      return Promise.resolve(undefined)
    })

    await act(async () =>
      root.render(
        createElement(Probe, {
          onBrowser: (value) => {
            browser = value
          },
          onState: vi.fn(),
        }),
      ),
    )
    await act(async () => {
      stateRequests.get("session-a")!.resolve({
        tabs: [{ id: 1, title: "old" }],
        activeId: 1,
      })
    })
    const closing = browser!.close(1)
    await act(async () => setAgentSessionId("session-b"))
    await act(async () => {
      stateRequests.get("session-b")!.resolve({ tabs: [], activeId: null })
      oldClose.resolve({ tabs: [], activeId: null })
      await closing
    })

    expect(closeEvents).toEqual([])
    window.removeEventListener("larify:workbench-close", onCloseWorkbench)
  })

})
