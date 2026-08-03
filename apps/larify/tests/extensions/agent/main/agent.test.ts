import { describe, it, expect } from "vitest"
import { z } from "zod"
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test"
import { readUIMessageStream, type UIMessage } from "ai"
import { runAgentUIStream } from "../../../../src/extensions/agent/main/agent"
import { runAgentSession } from "../../../../src/extensions/agent/main/run-session"

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

function mockModel(chunks: string[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "0" },
        ...chunks.map((delta) => ({ type: "text-delta" as const, id: "0", delta })),
        { type: "text-end", id: "0" },
        {
          type: "finish",
          finishReason: "stop" as const,
          usage: {
            inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 }
          }
        }
      ])
    })
  })
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

async function assemble(model: MockLanguageModelV4): Promise<UIMessage> {
  const stream = runAgentUIStream({
    messages: [{ role: "user", content: "hi" }],
    tools: {},
    activeTools: [],
    toolsContext: {},
    model
  })
  let last: UIMessage | undefined
  for await (const msg of readUIMessageStream({ stream })) last = msg
  if (!last) throw new Error("no message assembled")
  return last
}

describe("runAgent", () => {
  it("streams chunks that assemble into an assistant message", async () => {
    const message = await assemble(mockModel(["I2C ", "bus 1: ", "0x48, 0x76"]))
    expect(message.role).toBe("assistant")
    expect(textOf(message)).toBe("I2C bus 1: 0x48, 0x76")
  })

  it("forwards the messages to the model", async () => {
    const model = mockModel(["ok"])
    await assemble(model)
    const sent = model.doStreamCalls[0].prompt
    expect(JSON.stringify(sent)).toContain("hi")
  })
})

describe("runAgentSession", () => {
  it("preserves the original UI messages and appends the response", async () => {
    const original: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] }
    ]
    const session = await runAgentSession(original, {
      tools: {},
      activeTools: [],
      toolsContext: {},
      model: mockModel(["hello"])
    })

    const messages = await session.messages
    expect(messages.slice(0, -1)).toEqual(original)
    expect(textOf(messages.at(-1)!)).toBe("hello")
  })

  it("reports UI stream chunks", async () => {
    const chunks: string[] = []
    const session = await runAgentSession(
      [{ id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      {
        tools: {},
        activeTools: [],
        toolsContext: {},
        model: mockModel(["hello"])
      },
      (chunk) => chunks.push(chunk.type)
    )

    await session.messages
    expect(chunks).toContain("text-delta")
  })

  it("reports tool input and output chunks across steps", async () => {
    let calls = 0
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream(
          calls++ === 0
            ? [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "echo",
                  input: '{"text":"hello"}'
                },
                { type: "finish", finishReason: "tool-calls", usage: USAGE }
              ]
            : [
                { type: "stream-start", warnings: [] },
                { type: "text-start", id: "0" },
                { type: "text-delta", id: "0", delta: "done" },
                { type: "text-end", id: "0" },
                { type: "finish", finishReason: "stop", usage: USAGE }
              ]
        )
      })
    })
    const chunks: string[] = []
    const session = await runAgentSession(
      [{ id: "user-1", role: "user", parts: [{ type: "text", text: "go" }] }],
      {
        tools: {
          echo: {
            description: "echo",
            inputSchema: z.object({ text: z.string() }),
            execute: async ({ text }) => text
          }
        },
        activeTools: ["echo"],
        toolsContext: {},
        model
      },
      (chunk) => chunks.push(chunk.type)
    )

    await session.messages
    expect(chunks).toEqual(
      expect.arrayContaining(["tool-input-available", "tool-output-available", "text-delta"])
    )
  })

  it("preserves tool error messages", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "fail",
            input: "{}"
          },
          { type: "finish", finishReason: "tool-calls", usage: USAGE }
        ])
      })
    })
    const errors: string[] = []
    const session = await runAgentSession(
      [{ id: "user-1", role: "user", parts: [{ type: "text", text: "go" }] }],
      {
        tools: {
          fail: {
            description: "fail",
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error("navigation failed: ERR_CONNECTION_RESET")
            }
          }
        },
        activeTools: ["fail"],
        toolsContext: {},
        model,
        stopWhen: () => true
      },
      (chunk) => {
        if (chunk.type === "tool-output-error") errors.push(chunk.errorText)
      }
    )

    await session.messages
    expect(errors).toEqual(["navigation failed: ERR_CONNECTION_RESET"])
  })

  it("keeps the latest partial message when streaming is interrupted", async () => {
    const parts = [
      { type: "stream-start" as const, warnings: [] },
      { type: "text-start" as const, id: "0" },
      { type: "text-delta" as const, id: "0", delta: "partial response" }
    ]
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          pull(controller) {
            const part = parts.shift()
            if (part) controller.enqueue(part)
            else controller.error(new Error("interrupted"))
          }
        })
      })
    })
    const original: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "go" }] }
    ]
    const session = await runAgentSession(
      original,
      {
        tools: {},
        activeTools: [],
        toolsContext: {},
        model
      }
    )

    await expect(session.messages).rejects.toThrow("interrupted")
    expect(textOf(session.latest().at(-1)!)).toBe("partial response")
  })
})

describe("prompt-cache middleware", () => {
  it("sends only the eager tools to the provider but keeps every tool executable", async () => {
    let sentToolNames: string[] = []
    let lazyRan = false
    let calls = 0
    const tools = {
      eager_tool: {
        description: "eager",
        inputSchema: z.object({}),
        metadata: { eager: true },
        execute: async () => "eager ran"
      },
      lazy_tool: {
        description: "lazy",
        inputSchema: z.object({}),
        execute: async () => {
          lazyRan = true
          return "lazy ran"
        }
      }
    }
    const model = new MockLanguageModelV4({
      doStream: async ({ tools: sent }) => {
        calls++
        sentToolNames = (sent ?? []).map((t) => t.name)
        if (calls > 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "0" },
              { type: "text-delta", id: "0", delta: "done" },
              { type: "text-end", id: "0" },
              { type: "finish", finishReason: "stop", usage: USAGE }
            ])
          }
        }
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "c1", toolName: "lazy_tool", input: "{}" },
            { type: "finish", finishReason: "tool-calls", usage: USAGE }
          ])
        }
      }
    })

    const stream = runAgentUIStream({
      messages: [{ role: "user", content: "go" }],
      tools: tools as never,
      activeTools: ["eager_tool"],
      toolsContext: {},
      model
    })
    for await (const _ of readUIMessageStream({ stream })) {
      void _
    }

    expect(sentToolNames).toEqual(["eager_tool"])
    expect(lazyRan).toBe(true)
    expect(calls).toBe(2)
  })
})
