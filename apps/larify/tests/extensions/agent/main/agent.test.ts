import { describe, it, expect } from "vitest"
import { z } from "zod"
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test"
import { readUIMessageStream, type UIMessage } from "ai"
import { runAgent } from "../../../../src/extensions/agent/main/agent"

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
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
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
        },
      ]),
    }),
  })
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

async function assemble(model: MockLanguageModelV4): Promise<UIMessage> {
  const stream = runAgent({
    messages: [{ role: "user", content: "hi" }],
    tools: {},
    activeTools: [],
    toolsContext: {},
    model,
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
        execute: async () => "eager ran",
      },
      lazy_tool: {
        description: "lazy",
        inputSchema: z.object({}),
        execute: async () => {
          lazyRan = true
          return "lazy ran"
        },
      },
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
              { type: "finish", finishReason: "stop", usage: USAGE },
            ]),
          }
        }
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "c1", toolName: "lazy_tool", input: "{}" },
            { type: "finish", finishReason: "tool-calls", usage: USAGE },
          ]),
        }
      },
    })

    const stream = runAgent({
      messages: [{ role: "user", content: "go" }],
      tools: tools as never,
      activeTools: ["eager_tool"],
      toolsContext: {},
      model,
    })
    for await (const _ of readUIMessageStream({ stream })) {
      void _
    }

    expect(sentToolNames).toEqual(["eager_tool"])
    expect(lazyRan).toBe(true)
    expect(calls).toBe(2)
  })
})
