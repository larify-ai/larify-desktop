import { afterEach, describe, expect, it, vi } from "vitest"
import { ipcTransport } from "../../../../src/extensions/assistant/renderer/lib/transport"

describe("assistant transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exposes the IPC chat transport", () => {
    expect(typeof ipcTransport.sendMessages).toBe("function")
    expect(typeof ipcTransport.reconnectToStream).toBe("function")
  })

  it("errors and cleans up the stream when agent:run cannot start", async () => {
    const listeners = new Map<string, Set<(value: unknown) => void>>()
    const invokeError = new Error("agent handler unavailable")
    const invoke = vi.fn().mockRejectedValue(invokeError)
    const on = vi.fn((channel: string, listener: (value: unknown) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set()
      channelListeners.add(listener)
      listeners.set(channel, channelListeners)
      return () => channelListeners.delete(listener)
    })
    vi.stubGlobal("window", { bridge: { invoke, on } })
    vi.stubGlobal("crypto", { randomUUID: () => "run-1" })

    const stream = await ipcTransport.sendMessages({
      chatId: "session-1",
      messages: [],
      trigger: "submit-message",
      messageId: undefined,
    })
    const reader = stream.getReader()

    await expect(reader.read()).rejects.toBe(invokeError)
    expect(invoke).toHaveBeenCalledWith("agent:run", {
      runId: "run-1",
      sessionId: "session-1",
      messages: [],
    })
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true)
  })

  it("closes an already-aborted stream even when cancellation fails", async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === "agent:cancel") throw new Error("cancel unavailable")
      return Promise.resolve()
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: () => () => undefined,
      },
    })
    vi.stubGlobal("crypto", { randomUUID: () => "run-2" })
    const abortController = new AbortController()
    abortController.abort()

    const stream = await ipcTransport.sendMessages({
      chatId: "session-1",
      messages: [],
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: abortController.signal,
    })

    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith("agent:cancel", "run-2")
    expect(invoke).not.toHaveBeenCalledWith("agent:run", expect.anything())
  })
})
