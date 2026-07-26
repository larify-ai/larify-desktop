// @vitest-environment jsdom

import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserViewport } from "../../../../src/extensions/browser/renderer/browser-viewport"
import { setAgentSessionId } from "../../../../src/renderer/src/lib/agent-session"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeResizeObserver {
  static instance: FakeResizeObserver | null = null

  constructor(private readonly cb: ResizeObserverCallback) {
    FakeResizeObserver.instance = this
  }
  observe(target: Element): void {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect(): void {
    if (FakeResizeObserver.instance === this) FakeResizeObserver.instance = null
  }
  notify(target: Element): void {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

describe("BrowserViewport", () => {
  let container: HTMLDivElement
  let root: Root
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    invoke = vi.fn().mockResolvedValue(undefined)
    setAgentSessionId("session-a")
    Object.defineProperty(window, "bridge", {
      configurable: true,
      value: { invoke },
    })
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: FakeResizeObserver,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 240,
      height: 200,
      left: 10,
      right: 310,
      top: 40,
      width: 300,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    FakeResizeObserver.instance = null
  })

  it("keeps the native browser view hidden until active workbench and bounds are known", async () => {
    await act(async () => root.render(createElement(BrowserViewport, { visible: true })))

    expect(invoke).toHaveBeenCalledWith("browser:setVisible", "session-a", false)
    expect(invoke).not.toHaveBeenCalledWith("browser:setVisible", "session-a", true)

    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "terminal" }))
    })
    expect(invoke).not.toHaveBeenCalledWith("browser:setVisible", "session-a", true)

    await act(async () => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: "browser" }))
    })
    expect(invoke).toHaveBeenCalledWith("browser:setBounds", "session-a", {
      height: 200,
      width: 300,
      x: 10,
      y: 40,
    })
    expect(invoke).toHaveBeenCalledWith("browser:setVisible", "session-a", true)
  })

  it("coalesces resize reports even when requestAnimationFrame returns zero", async () => {
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callbacks.push(callback)
        return 0
      })

    await act(async () => root.render(createElement(BrowserViewport, { visible: true })))
    const viewport = container.firstElementChild!
    FakeResizeObserver.instance!.notify(viewport)
    FakeResizeObserver.instance!.notify(viewport)

    expect(requestFrame).toHaveBeenCalledOnce()
    expect(callbacks).toHaveLength(1)
  })
})
