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
    service.state("session-a")

    const state = { tabs: [{ id: 1 }], activeId: 1 } as BrowserState
    const managers = h.managers as FakeBrowserTabManager[]
    managers[0].emit(state)

    expect(onChange).toHaveBeenCalledWith("session-a", state)
  })

  it("shows only the requested session", () => {
    const service = new BrowserService({} as never)
    service.state("session-a")
    service.state("session-b")

    service.setVisible("session-b", true)

    const managers = h.managers as FakeBrowserTabManager[]
    expect(managers[0].setVisible).toHaveBeenCalledWith(false)
    expect(managers[1].setVisible).toHaveBeenLastCalledWith(true)
  })

  it("destroys session managers", async () => {
    const service = new BrowserService({} as never)
    service.state("session-a")
    service.state("session-b")

    await service.destroySession("session-a")
    const managers = h.managers as FakeBrowserTabManager[]
    expect(managers[0].destroy).toHaveBeenCalled()
    expect(managers[1].destroy).not.toHaveBeenCalled()

    await service.destroy()
    expect(managers[1].destroy).toHaveBeenCalled()
  })
})
