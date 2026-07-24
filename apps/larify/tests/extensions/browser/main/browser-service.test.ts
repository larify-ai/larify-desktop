import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BrowserState } from "../../../../src/extensions/browser/shared/types"

const h = vi.hoisted(() => {
  const managers: unknown[] = []
  return {
    managers,
    BrowserTabManager: class {
      readonly window: unknown
      bindChange = vi.fn((callback: (state: BrowserState) => void) => {
        this.onChange = callback
      })
      state = vi.fn(() => ({ tabs: [], activeId: null }))
      createTab = vi.fn(() => 1)
      setActive = vi.fn()
      reorder = vi.fn()
      close = vi.fn()
      navigate = vi.fn(() => true)
      goBack = vi.fn()
      goForward = vi.fn()
      reload = vi.fn()
      setBounds = vi.fn()
      setVisible = vi.fn()
      destroy = vi.fn()
      private onChange?: (state: BrowserState) => void

      constructor(window: unknown) {
        this.window = window
        managers.push(this)
      }

      emit(state: BrowserState): void {
        this.onChange?.(state)
      }
    },
  }
})

type FakeBrowserTabManager = InstanceType<typeof h.BrowserTabManager>

vi.mock("../../../../src/extensions/browser/main/tab-manager", () => ({
  BrowserTabManager: h.BrowserTabManager,
}))

import { BrowserService } from "../../../../src/extensions/browser/main/browser-service"

describe("BrowserService", () => {
  beforeEach(() => {
    h.managers.length = 0
  })

  it("does not allocate a browser manager when reading an empty session", () => {
    const service = new BrowserService({} as never)

    expect(service.state("unused-session")).toEqual({ tabs: [], activeId: null })
    expect(h.managers).toHaveLength(0)
  })

  it("does not allocate a manager for layout or stale tab operations", () => {
    const service = new BrowserService({} as never)
    service.setBounds("unused-session", { x: 1, y: 2, width: 3, height: 4 })
    service.setActive("unused-session", 1)
    service.close("unused-session", 1)

    expect(service.tab("unused-session", 1)).toBeUndefined()
    expect(service.navigate("unused-session", 1, "https://example.com")).toBe(false)
    expect(h.managers).toHaveLength(0)

    service.createTab("unused-session")
    expect((h.managers[0] as FakeBrowserTabManager).setBounds).toHaveBeenCalledWith({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    })
  })

  it("keeps tabs isolated by session", () => {
    const service = new BrowserService({} as never)

    expect(service.createTab("session-a")).toBe(1)
    expect(service.createTab("session-b", "https://example.com")).toBe(1)

    expect(h.managers).toHaveLength(2)
    const managers = h.managers as FakeBrowserTabManager[]
    expect(managers[0].createTab).toHaveBeenCalledWith(undefined)
    expect(managers[1].createTab).toHaveBeenCalledWith("https://example.com")
  })

  it("emits state changes with the owning session id", () => {
    const service = new BrowserService({} as never)
    const onChange = vi.fn()
    service.bindChange(onChange)
    service.createTab("session-a")

    const state = { tabs: [{ id: 1 }], activeId: 1 } as BrowserState
    const managers = h.managers as FakeBrowserTabManager[]
    managers[0].emit(state)

    expect(onChange).toHaveBeenCalledWith("session-a", state)
  })

  it("shows only the requested session", () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    service.createTab("session-b")

    service.setVisible("session-b", true)

    const managers = h.managers as FakeBrowserTabManager[]
    expect(managers[0].setVisible).toHaveBeenCalledWith(false)
    expect(managers[1].setVisible).toHaveBeenLastCalledWith(true)
  })

  it("hides only the requested session", () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    service.createTab("session-b")
    const managers = h.managers as FakeBrowserTabManager[]

    service.setVisible("session-a", false)

    expect(managers[0].setVisible).toHaveBeenCalledWith(false)
    expect(managers[1].setVisible).not.toHaveBeenCalled()
  })

  it("destroys session managers", async () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    service.createTab("session-b")

    await service.destroySession("session-a")
    const managers = h.managers as FakeBrowserTabManager[]
    expect(managers[0].destroy).toHaveBeenCalled()
    expect(managers[1].destroy).not.toHaveBeenCalled()

    await service.destroy()
    expect(managers[1].destroy).toHaveBeenCalled()
  })
})
