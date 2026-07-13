import { describe, it, expect } from "vitest"
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test"
import { readUIMessageStream, type UIMessage } from "ai"
import { runAgent } from "../../../../src/extensions/agent/main/agent"

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
  const stream = runAgent([{ role: "user", content: "hi" }], undefined, model)
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
