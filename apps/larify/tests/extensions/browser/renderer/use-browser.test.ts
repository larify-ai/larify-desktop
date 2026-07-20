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
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
    expect(invoke).not.toHaveBeenCalledWith("browser:create", "session-a")

    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })

    expect(invoke).not.toHaveBeenCalledWith("browser:create", "session-a")

    await act(async () => {
      stateRequest.resolve({ tabs: [], activeId: null })
    })

    expect(invoke).toHaveBeenCalledWith("browser:create", "session-a")
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
    expect(invoke.mock.calls.filter((call) => call[0] === "browser:create")).toHaveLength(0)
    window.removeEventListener("larify:workbench-close", onCloseWorkbench)
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
})
