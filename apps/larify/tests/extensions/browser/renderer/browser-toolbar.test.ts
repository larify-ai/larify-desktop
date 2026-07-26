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

const enterText = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
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

  it("blurs the captured input after asynchronous navigation succeeds", async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(true),
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
    const blur = vi.spyOn(input, "blur")

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      await Promise.resolve()
    })

    expect(blur).toHaveBeenCalledOnce()
  })

  it("keeps address text when asynchronous navigation rejects", async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockRejectedValue(new Error("IPC unavailable")),
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
      input.value = "example.com"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      await Promise.resolve()
    })

    expect(input.value).toBe("example.com")
    expect(document.activeElement).toBe(input)
  })

  it("discards the address draft when the active tab changes", async () => {
    const props = {
      onBack: vi.fn(),
      onForward: vi.fn(),
      onNavigate: vi.fn().mockResolvedValue(true),
      onReload: vi.fn(),
    }
    await act(async () => {
      root.render(createElement(BrowserToolbar, { ...props, tab }))
    })
    await act(async () => {
      container.querySelector("button:not([aria-label])")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })
    await act(async () => {
      const input = container.querySelector("input")!
      input.value = "draft.example"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          ...props,
          tab: { ...tab, id: 2, url: "https://example.com/path" },
        }),
      )
    })

    expect(container.querySelector("input")).toBeNull()
    expect(container.querySelector("button:not([aria-label])")?.textContent).toBe(
      "example.com/path",
    )
  })

  it("does not let an old navigation failure overwrite newer input", async () => {
    let rejectNavigation!: (reason?: unknown) => void
    const onNavigate = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectNavigation = reject
        }),
    )
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate,
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
      enterText(input, "first.example")
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    })
    await act(async () => {
      enterText(input, "second.example")
    })
    await act(async () => {
      rejectNavigation(new Error("navigation failed"))
      await Promise.resolve()
    })

    expect(input.value).toBe("second.example")
  })
})
