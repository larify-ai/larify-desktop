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
})
