import { describe, expect, it, vi } from "vitest"
import { SessionScopedManagers } from "../../../src/main/utils/session-scoped-managers"

describe("SessionScopedManagers", () => {
  it("lazily creates and reuses managers per session", () => {
    const create = vi.fn((sessionId: string) => ({ sessionId }))
    const managers = new SessionScopedManagers(create)

    expect(managers.get("a")).toBe(managers.get("a"))
    expect(managers.get("b")).toEqual({ sessionId: "b" })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("destroys one session or all sessions", async () => {
    const destroy = vi.fn()
    const managers = new SessionScopedManagers(
      (sessionId: string) => ({ sessionId }),
      destroy,
    )
    const first = managers.get("a")
    const second = managers.get("b")

    await managers.destroySession("a")
    expect(destroy).toHaveBeenCalledWith(first)
    expect(managers.get("b")).toBe(second)

    await managers.destroyAll()
    expect(destroy).toHaveBeenCalledWith(second)
  })

  it("removes a session before awaiting asynchronous destruction", async () => {
    let finishDestroy!: () => void
    const destroy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve
        }),
    )
    const managers = new SessionScopedManagers(
      (sessionId: string) => ({ sessionId }),
      destroy,
    )
    const oldManager = managers.get("a")

    const pending = managers.destroySession("a")
    expect(managers.peek("a")).toBeUndefined()
    expect(managers.get("a")).not.toBe(oldManager)
    finishDestroy()
    await pending
  })

  it("does not destroy the same manager twice when destroySession races", async () => {
    let finishDestroy!: () => void
    const destroy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve
        }),
    )
    const managers = new SessionScopedManagers(() => ({}), destroy)
    managers.get("a")

    const first = managers.destroySession("a")
    const second = managers.destroySession("a")
    expect(destroy).toHaveBeenCalledTimes(1)
    finishDestroy()
    await Promise.all([first, second])
  })
})
