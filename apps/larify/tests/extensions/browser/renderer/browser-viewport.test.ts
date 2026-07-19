// @vitest-environment jsdom

import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserViewport } from "../../../../src/extensions/browser/renderer/browser-viewport"
import { setAgentSessionId } from "../../../../src/renderer/src/lib/agent-session"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect(): void {}
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
})
