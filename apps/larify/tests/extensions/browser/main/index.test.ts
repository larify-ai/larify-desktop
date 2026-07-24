import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  let finishDestroy!: () => void
  const destroyDone = new Promise<void>((resolve) => {
    finishDestroy = resolve
  })
  return {
    finishDestroy,
    destroyDone,
    destroy: vi.fn(() => destroyDone),
    unregisterIpc: vi.fn(),
  }
})

vi.mock("../../../../src/extensions/browser/main/browser-service", () => ({
  BrowserService: class {
    destroy = h.destroy
  },
}))

vi.mock("../../../../src/extensions/browser/main/ipc", () => ({
  registerBrowserIpc: (getService: () => unknown) => {
    getService()
    return h.unregisterIpc
  },
}))

vi.mock("../../../../src/extensions/browser/main/tools", () => ({
  createBrowserToolkit: () => ({}),
}))

import extension from "../../../../src/extensions/browser/main"

describe("browser extension disposal", () => {
  it("waits for browser resources and recording output to finish destroying", async () => {
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const app = {
      get: vi.fn(() => ({ get: () => ({}) })),
      register: vi.fn(() => ({ dispose: vi.fn() })),
    }

    await extension.activate(app as never, { subscriptions } as never)
    const cleanup = subscriptions.at(-1)
    if (!cleanup) throw new Error("browser cleanup subscription was not registered")

    const disposal = cleanup.dispose()
    expect(disposal).toBeInstanceOf(Promise)
    let settled = false
    void Promise.resolve(disposal).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    h.finishDestroy()
    await disposal
    expect(h.unregisterIpc).toHaveBeenCalledOnce()
    expect(h.destroy).toHaveBeenCalledOnce()
  })
})
