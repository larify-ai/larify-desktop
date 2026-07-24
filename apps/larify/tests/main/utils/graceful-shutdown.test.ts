import { describe, expect, it, vi } from "vitest"
import {
  installGracefulShutdown,
  type QuitEvent,
} from "../../../src/main/utils/graceful-shutdown"

describe("graceful shutdown", () => {
  it("waits for disposal before allowing the second quit", async () => {
    let beforeQuit: ((event: QuitEvent) => void) | undefined
    let finishDispose: (() => void) | undefined
    const dispose = vi.fn(
      () => new Promise<void>((resolve) => {
        finishDispose = resolve
      }),
    )
    const app = {
      on: vi.fn((_event: "before-quit", listener: (event: QuitEvent) => void) => {
        beforeQuit = listener
      }),
      quit: vi.fn(),
    }
    installGracefulShutdown(app, dispose)
    const event = { preventDefault: vi.fn() }

    beforeQuit?.(event)
    beforeQuit?.(event)
    await Promise.resolve()

    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()

    finishDispose?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.quit).toHaveBeenCalledTimes(1)

    beforeQuit?.(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it("still quits when disposal fails", async () => {
    let beforeQuit: ((event: QuitEvent) => void) | undefined
    const app = {
      on: vi.fn((_event: "before-quit", listener: (event: QuitEvent) => void) => {
        beforeQuit = listener
      }),
      quit: vi.fn(),
    }
    installGracefulShutdown(app, () => Promise.reject(new Error("dispose failed")))

    beforeQuit?.({ preventDefault: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(app.quit).toHaveBeenCalledTimes(1)
  })
})
