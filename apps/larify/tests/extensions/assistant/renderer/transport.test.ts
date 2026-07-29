import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createIpcTransport } from "../../../../src/extensions/assistant/renderer/lib/transport"
import { defaultModelConfig } from "../../../../src/extensions/agent/shared/model"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("assistant IPC transport review lifecycle", () => {
  it("appends the review snapshot after agent chunks and removes its listeners", async () => {
    const listeners = new Map<string, Set<(value?: unknown) => void>>()
    const snapshot = { additions: 1, deletions: 0, files: [] }
    let runId = ""
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === "review:begin") {
        runId = args[0] as string
        return null
      }
      if (channel === "agent:run") {
        emit(`agent:chunk:${runId}`, { type: "text-delta", id: "text", delta: "hello" })
        emit(`agent:end:${runId}`)
        return null
      }
      if (channel === "review:finish") return snapshot
      return null
    })
    const on = vi.fn((channel: string, callback: (value?: unknown) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set()
      channelListeners.add(callback)
      listeners.set(channel, channelListeners)
      return () => channelListeners.delete(callback)
    })
    const emit = (channel: string, value?: unknown): void => {
      listeners.get(channel)?.forEach((callback) => callback(value))
    }
    vi.stubGlobal("window", { bridge: { invoke, on } })

    const chunks = await readAll(await send())

    expect(chunks).toEqual([
      { type: "text-delta", id: "text", delta: "hello" },
      { type: "data-git-snapshot", data: snapshot },
    ])
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "review:begin",
      "agent:run",
      "review:finish",
    ])
    expect([...listeners.values()].every((channelListeners) => channelListeners.size === 0)).toBe(
      true,
    )
  })

  it("persists a review snapshot appended after the agent finish chunk", async () => {
    const listeners = new Map<string, (value?: unknown) => void>()
    const snapshot = {
      files: [{ additions: 1, deletions: 0, path: "src/app.ts", patch: "@@ -0,0 +1 @@\n+new" }],
    }
    let runId = ""
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === "review:begin") {
        runId = args[0] as string
      } else if (channel === "agent:run") {
        listeners.get(`agent:chunk:${runId}`)?.({ type: "finish", finishReason: "stop" })
        listeners.get(`agent:end:${runId}`)?.()
      } else if (channel === "review:finish") {
        return snapshot
      }
      return null
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: (channel: string, callback: (value?: unknown) => void) => {
          listeners.set(channel, callback)
          return () => listeners.delete(channel)
        },
      },
    })

    let message: UIMessage | undefined
    for await (const current of readUIMessageStream({
      stream: (await send()) as ReadableStream<UIMessageChunk>,
    })) {
      message = current
    }

    expect(message?.parts).toContainEqual({ type: "data-git-snapshot", data: snapshot })
  })

  it("continues the agent run when review begin fails", async () => {
    let runId = ""
    const listeners = new Map<string, (value?: unknown) => void>()
    const error = new Error("review begin failed")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === "review:begin") {
        runId = args[0] as string
        throw error
      }
      if (channel === "agent:run") {
        listeners.get(`agent:end:${runId}`)?.()
      }
      return null
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: (channel: string, callback: (value?: unknown) => void) => {
          listeners.set(channel, callback)
          return () => listeners.delete(channel)
        },
      },
    })

    expect(await readAll(await send())).toEqual([])
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(["review:begin", "agent:run"])
    expect(consoleError).toHaveBeenCalledWith("[review:begin]", error)
  })

  it("closes the agent stream normally when review finish fails", async () => {
    let runId = ""
    const listeners = new Map<string, (value?: unknown) => void>()
    const error = new Error("review finish failed")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === "review:begin") {
        runId = args[0] as string
      } else if (channel === "agent:run") {
        listeners.get(`agent:chunk:${runId}`)?.({ type: "text-delta", id: "text", delta: "hello" })
        listeners.get(`agent:end:${runId}`)?.()
      } else if (channel === "review:finish") {
        throw error
      }
      return null
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: (channel: string, callback: (value?: unknown) => void) => {
          listeners.set(channel, callback)
          return () => listeners.delete(channel)
        },
      },
    })

    expect(await readAll(await send())).toEqual([
      { type: "text-delta", id: "text", delta: "hello" },
    ])
    expect(consoleError).toHaveBeenCalledWith("[review:finish]", error)
  })

  it("finishes the review and preserves an agent run error", async () => {
    const error = new Error("agent run failed")
    const listeners = new Map<string, Set<(value?: unknown) => void>>()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "agent:run") throw error
      return null
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: (channel: string, callback: (value?: unknown) => void) => {
          const channelListeners = listeners.get(channel) ?? new Set()
          channelListeners.add(callback)
          listeners.set(channel, channelListeners)
          return () => channelListeners.delete(callback)
        },
      },
    })

    const reader = (await send()).getReader()
    await expect(reader.read()).rejects.toBe(error)
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "review:begin",
      "agent:run",
      "review:finish",
    ])
    expect([...listeners.values()].every((channelListeners) => channelListeners.size === 0)).toBe(
      true,
    )
  })

  it("waits for review begin before finishing an immediately cancelled run", async () => {
    let resolveBegin: (() => void) | undefined
    const begin = new Promise<void>((resolve) => {
      resolveBegin = resolve
    })
    const calls: string[] = []
    const abort = new AbortController()

    vi.stubGlobal("window", {
      bridge: {
        invoke: async (channel: string) => {
          calls.push(channel)
          if (channel === "review:begin") return begin
          return null
        },
        on: () => () => undefined,
      },
    })

    const transport = createIpcTransport(() => "C:/workspace", () => defaultModelConfig)
    const stream = await transport.sendMessages({
      abortSignal: abort.signal,
      chatId: "session-1",
      messages: [],
      trigger: "submit-message",
    })
    abort.abort()
    resolveBegin?.()

    expect((await stream.getReader().read()).done).toBe(true)
    expect(calls).toEqual(["review:begin", "agent:cancel", "review:finish"])
    expect(calls).not.toContain("agent:run")
  })

  it("closes an already-aborted stream even when cancellation fails", async () => {
    const abort = new AbortController()
    abort.abort()
    const cancelError = new Error("cancel unavailable")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "agent:cancel") throw cancelError
      return null
    })
    vi.stubGlobal("window", {
      bridge: { invoke, on: () => () => undefined },
    })

    expect(await readAll(await send(abort.signal))).toEqual([])
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "review:begin",
      "agent:cancel",
      "review:finish",
    ])
    expect(consoleError).toHaveBeenCalledWith("[agent:cancel]", cancelError)
  })

  it("finishes the review only once when agent end is emitted twice", async () => {
    let runId = ""
    const listeners = new Map<string, (value?: unknown) => void>()
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === "review:begin") {
        runId = args[0] as string
      } else if (channel === "agent:run") {
        listeners.get(`agent:end:${runId}`)?.()
        listeners.get(`agent:end:${runId}`)?.()
      }
      return null
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: (channel: string, callback: (value?: unknown) => void) => {
          listeners.set(channel, callback)
          return () => listeners.delete(channel)
        },
      },
    })

    await readAll(await send())
    expect(invoke.mock.calls.filter(([channel]) => channel === "review:finish")).toHaveLength(1)
  })

  it("forwards the selected model and thinking mode to the agent run", async () => {
    const listeners = new Map<string, (value?: unknown) => void>()
    const modelConfig = { modelId: "deepseek-v4-flash", thinking: "enabled" } as const
    let request: Record<string, unknown> | undefined
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === "agent:run") {
        request = args[0] as Record<string, unknown>
        listeners.get(`agent:end:${request.runId as string}`)?.()
      }
      return null
    })
    vi.stubGlobal("window", {
      bridge: {
        invoke,
        on: (channel: string, callback: (value?: unknown) => void) => {
          listeners.set(channel, callback)
          return () => listeners.delete(channel)
        },
      },
    })

    const stream = await createIpcTransport(
      () => "C:/workspace",
      () => modelConfig,
    ).sendMessages({ chatId: "session-1", messages: [], trigger: "submit-message" })
    await readAll(stream)

    expect(request?.modelConfig).toEqual(modelConfig)
  })
})

async function send(abortSignal?: AbortSignal): Promise<ReadableStream<unknown>> {
  return createIpcTransport(() => "C:/workspace", () => defaultModelConfig).sendMessages({
    abortSignal,
    chatId: "session-1",
    messages: [],
    trigger: "submit-message",
  })
}

async function readAll(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = []
  const reader = stream.getReader()
  for (;;) {
    const result = await reader.read()
    if (result.done) return chunks
    chunks.push(result.value)
  }
}
