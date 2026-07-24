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
      recordStart = vi.fn(async () => 1)
      recordStop = vi.fn(async () => ({ path: "out.webm", bytes: 1 }))
      recordStopIfCurrent = vi.fn(async () => null)
      recordRestart = vi.fn(async () => 2)
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

  it("does not allocate a manager for stale recording operations", async () => {
    const service = new BrowserService({} as never)

    await expect(service.recordStop("unused-session")).rejects.toThrow("no recording in progress")
    await expect(service.recordStopIfCurrent("unused-session", 1)).resolves.toBeNull()
    await expect(service.recordStart("unused-session", {} as never, "out.webm")).rejects.toThrow(
      "browser session is not active",
    )
    await expect(service.recordRestart("unused-session", {} as never, "out.webm")).rejects.toThrow(
      "browser session is not active",
    )
    expect(h.managers).toHaveLength(0)
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

  it("returns the final session state after closing a tab", async () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    const manager = h.managers[0] as FakeBrowserTabManager
    const finalState = { tabs: [{ id: 2 }], activeId: 2 } as BrowserState
    manager.state.mockReturnValue(finalState)

    await expect(service.close("session-a", 1)).resolves.toEqual(finalState)
    expect(manager.close).toHaveBeenCalledWith(1)
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

  it("does not recreate a session while that session is being destroyed", async () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    const manager = h.managers[0] as FakeBrowserTabManager
    let finishDestroy!: () => void
    manager.destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve
        }),
    )

    const destroying = service.destroySession("session-a")
    expect(() => service.createTab("session-a")).toThrow("browser session is being destroyed")
    expect(h.managers).toHaveLength(1)

    finishDestroy()
    await destroying
    expect(service.createTab("session-a")).toBe(1)
    expect(h.managers).toHaveLength(2)
  })

  it("does not create managers after service destruction starts", async () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    const manager = h.managers[0] as FakeBrowserTabManager
    let finishDestroy!: () => void
    manager.destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve
        }),
    )

    const destroying = service.destroy()
    expect(() => service.createTab("session-b")).toThrow("browser service is destroyed")
    expect(h.managers).toHaveLength(1)

    await vi.waitFor(() => expect(finishDestroy).toBeTypeOf("function"))
    finishDestroy()
    await destroying
    expect(() => service.createTab("session-b")).toThrow("browser service is destroyed")
  })

  it("waits for a manager when global and session destruction start in the same tick", async () => {
    const service = new BrowserService({} as never)
    service.createTab("session-a")
    const manager = h.managers[0] as FakeBrowserTabManager
    let finishDestroy!: () => void
    manager.destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve
        }),
    )

    const destroyingAll = service.destroy()
    const destroyingSession = service.destroySession("session-a")
    const beforeManagerFinishes = await Promise.race([
      destroyingAll.then(() => "done"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 10)),
    ])

    expect(beforeManagerFinishes).toBe("pending")
    expect(destroyingSession).toBe(destroyingAll)
    finishDestroy()
    await Promise.all([destroyingAll, destroyingSession])
  })
})
