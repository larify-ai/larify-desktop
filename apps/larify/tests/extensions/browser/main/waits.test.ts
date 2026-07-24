import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  urlMatches,
  waitForOperationOrAbort,
  waitForFunction,
  waitForSelector,
  waitMs,
} from "../../../../src/extensions/browser/main/waits"

describe("waitForOperationOrAbort", () => {
  it("handles a later operation rejection when the signal is already aborted", async () => {
    let rejectOperation!: (error: Error) => void
    const operation = new Promise<void>((_resolve, reject) => {
      rejectOperation = reject
    })
    const controller = new AbortController()
    controller.abort()
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    try {
      await expect(
        waitForOperationOrAbort(operation, controller.signal),
      ).rejects.toThrow("operation aborted")

      rejectOperation(new Error("late operation failure"))
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })
})

describe("waitMs abort handling", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(waitMs(50_000, controller.signal)).resolves.toBeUndefined()
  })

  it("resolves early when aborted mid-wait instead of waiting out the timeout", async () => {
    const controller = new AbortController()
    let resolved = false
    const pending = waitMs(50_000, controller.signal).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(resolved).toBe(false)

    controller.abort()
    await pending
    expect(resolved).toBe(true)
  })
})

describe("poll retries transient evaluation failures", () => {
  it("stops polling when the operation is aborted", async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => ({ result: { value: false } }))
    const pending = waitForSelector(send as never, ".missing", "visible", 50_000, controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow("aborted")
  })

  it("keeps polling when a page evaluation throws, then resolves once it succeeds", async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error("Execution context was destroyed")
      return { result: { value: true } }
    })

    await expect(waitForFunction(send as never, "ready", 5000)).resolves.toBeUndefined()
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it.each([
    "tab was closed",
    "Target closed",
    "Object has been destroyed",
    "Debugger is not attached",
  ])("reports terminal CDP failure immediately: %s", async (message) => {
    const send = vi.fn().mockRejectedValue(new Error(message))

    await expect(waitForSelector(send as never, "#target", "visible", 25_000)).rejects.toThrow(
      message,
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("times out with a labeled error when the condition never holds", async () => {
    const send = vi.fn(async () => ({ result: { value: false } }))
    await expect(waitForFunction(send as never, "never", 0)).rejects.toThrow(
      "wait_for_function timed out",
    )
  })

  it("reports an invalid selector immediately with its parse error", async () => {
    const send = vi.fn(async () => ({
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "SyntaxError: Failed to execute 'querySelector'" },
      },
    }))

    await expect(waitForSelector(send as never, "input[", "visible", 0)).rejects.toThrow(
      "SyntaxError: Failed to execute 'querySelector'",
    )
  })

  it.each(["visible", "hidden"] as const)(
    "checks ancestor visibility and element geometry for %s",
    async (state) => {
      const send = vi.fn(async (_method: string, params: { expression: string }) => {
        expect(params.expression).toContain("parentElement")
        expect(params.expression).toContain("getRootNode")
        expect(params.expression).toContain("getBoundingClientRect")
        return { result: { value: true } }
      })

      await waitForSelector(send as never, "#target", state, 0)
    },
  )
})

describe("urlMatches", () => {
  it("matches wildcards and literal substrings", () => {
    expect(urlMatches("*", "https://any")).toBe(true)
    expect(urlMatches("example.com", "https://example.com/x")).toBe(true)
    expect(urlMatches("https://*/checkout", "https://shop.test/checkout")).toBe(true)
    expect(urlMatches("https://*/checkout", "https://shop.test/cart")).toBe(false)
  })
})
