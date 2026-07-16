// @vitest-environment jsdom

import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkbenchTabs } from "../../../../src/renderer/src/components/workbench"

describe("WorkbenchTabs", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("renders tabs and create button", async () => {
    const onSelect = vi.fn()
    const onCreate = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          tabs: [
            { active: true, id: "one", title: "One" },
            { id: "two", title: "Two" },
          ],
          onCreate,
          onSelect,
        }),
      )
    })

    expect(container.textContent).toContain("One")
    expect(container.textContent).toContain("Two")

    const createButton = container.querySelector<HTMLButtonElement>('button[aria-label="新建"]')
    expect(createButton).not.toBeNull()

    createButton?.click()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it("renders active and closable state", async () => {
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          tabs: [
            { active: true, id: "one", title: "One" },
            { closable: false, id: "two", title: "Two" },
          ],
          onSelect,
        }),
      )
    })

    expect(container.querySelector('[data-tab-id="one"]')?.getAttribute("aria-selected")).toBe("true")
    expect(container.querySelectorAll('[aria-label="关闭"]')).toHaveLength(1)
  })

  it("reports tab reorder when pointer dragging over another tab", async () => {
    const onReorder = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          draggable: true,
          tabs: [
            { active: true, id: "one", title: "One" },
            { id: "two", title: "Two" },
          ],
          onReorder,
          onSelect,
        }),
      )
    })

    const one = container.querySelector<HTMLElement>('[data-tab-id="one"]')
    one!.setPointerCapture = vi.fn()
    Object.defineProperty(one, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 0, right: 100, top: 0, width: 100 }),
    })
    Object.defineProperty(container.querySelector<HTMLElement>('[data-tab-id="two"]'), "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 100, right: 200, top: 0, width: 100 }),
    })

    await act(async () => {
      one?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 1 }))
      one?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 160, clientY: 0, pointerId: 1 }))
      one?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 160, clientY: 0, pointerId: 1 }))
    })

    expect(onReorder).toHaveBeenCalledWith("one", 0, 1)
  })

  it("clamps tab dragging inside the tab strip", async () => {
    const onReorder = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          draggable: true,
          tabs: [
            { active: true, id: "one", title: "One" },
            { id: "two", title: "Two" },
          ],
          onReorder,
          onSelect,
        }),
      )
    })

    const strip = container.querySelector<HTMLElement>(".larify-workbench-tabs-scroll")
    const one = container.querySelector<HTMLElement>('[data-tab-id="one"]')
    const two = container.querySelector<HTMLElement>('[data-tab-id="two"]')
    one!.setPointerCapture = vi.fn()
    Object.defineProperty(strip, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 0, right: 200, top: 0, width: 200 }),
    })
    Object.defineProperty(one, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 0, right: 100, top: 0, width: 100 }),
    })
    Object.defineProperty(two, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 100, right: 200, top: 0, width: 100 }),
    })

    await act(async () => {
      one?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 1 }))
      one?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 1000, clientY: 0, pointerId: 1 }))
    })

    expect(one?.style.transform).toContain("translateX(100px)")

    await act(async () => {
      one?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 1000, clientY: 0, pointerId: 1 }))
    })

    expect(onReorder).toHaveBeenCalledWith("one", 0, 1)
  })

  it("does not move sibling tabs when the first tab is dragged past the left edge", async () => {
    const onReorder = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          draggable: true,
          tabs: [
            { active: true, id: "one", title: "One" },
            { id: "two", title: "Two" },
          ],
          onReorder,
          onSelect,
        }),
      )
    })

    const strip = container.querySelector<HTMLElement>(".larify-workbench-tabs-scroll")
    const one = container.querySelector<HTMLElement>('[data-tab-id="one"]')
    const two = container.querySelector<HTMLElement>('[data-tab-id="two"]')
    one!.setPointerCapture = vi.fn()
    Object.defineProperty(strip, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 0, right: 200, top: 0, width: 200 }),
    })
    Object.defineProperty(one, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 0, right: 100, top: 0, width: 100 }),
    })
    Object.defineProperty(two, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 100, right: 200, top: 0, width: 100 }),
    })

    await act(async () => {
      one?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 1 }))
      one?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: -1000, clientY: 0, pointerId: 1 }))
    })

    expect(one?.style.transform).toContain("translateX(0px)")
    expect(two?.style.transform).toBe("")

    await act(async () => {
      one?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: -1000, clientY: 0, pointerId: 1 }))
    })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it("allows the next normal click after a drag ends", async () => {
    const onReorder = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          draggable: true,
          tabs: [
            { active: true, id: "one", title: "One" },
            { id: "two", title: "Two" },
          ],
          onReorder,
          onSelect,
        }),
      )
    })

    const one = container.querySelector<HTMLElement>('[data-tab-id="one"]')
    const two = container.querySelector<HTMLElement>('[data-tab-id="two"]')
    one!.setPointerCapture = vi.fn()
    Object.defineProperty(one, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 0, right: 100, top: 0, width: 100 }),
    })
    Object.defineProperty(two, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 36, height: 36, left: 100, right: 200, top: 0, width: 100 }),
    })

    await act(async () => {
      one?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 1 }))
      one?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 160, clientY: 0, pointerId: 1 }))
      one?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 160, clientY: 0, pointerId: 1 }))
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await act(async () => {
      two?.click()
    })

    expect(onReorder).toHaveBeenCalledWith("one", 0, 1)
    expect(onSelect).toHaveBeenCalledWith("two")
  })

  it("keeps create action available without tabs", async () => {
    const onCreate = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          tabs: [],
          onCreate,
          onSelect,
        }),
      )
    })

    const createButton = container.querySelector<HTMLButtonElement>('button[aria-label="新建"]')
    expect(createButton).not.toBeNull()
  })
})
