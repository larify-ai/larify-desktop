// @vitest-environment jsdom

import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserToolbar } from "../../../../src/extensions/browser/renderer/browser-toolbar"
import type { BrowserTabState } from "../../../../src/extensions/browser/shared/types"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const tab: BrowserTabState = {
  canGoBack: false,
  canGoForward: false,
  error: null,
  favIconUrl: "",
  id: 1,
  loading: false,
  title: "",
  url: "",
}

describe("BrowserToolbar", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("keeps invalid address text in the input when navigation is rejected", async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(false),
          onReload: vi.fn(),
          tab,
        }),
      )
    })

    await act(async () => {
      container.querySelector("button:not([aria-label])")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    const input = container.querySelector("input")!
    await act(async () => {
      input.focus()
      input.value = "baidu"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      await Promise.resolve()
    })

    expect(input.value).toBe("baidu")
  })
})
