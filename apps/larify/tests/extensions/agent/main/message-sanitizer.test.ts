import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  sanitizeAndValidateMessages,
  sanitizeMessages,
} from "../../../../src/extensions/agent/main/message-sanitizer"

describe("message sanitizer", () => {
  it("removes interrupted assistant tool calls without results", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "run a tool" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I will check." },
          {
            type: "tool-call_tool",
            toolCallId: "call-1",
            state: "input-available",
            input: { title: "Check", tool_name: "read_file", tool_args: {} },
          },
        ],
      } as UIMessage,
    ]

    expect(sanitizeMessages(messages)).toEqual([
      messages[0],
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "I will check." }],
      },
    ])
  })

  it("keeps completed tool calls", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-call_tool",
          toolCallId: "call-1",
          state: "output-available",
          input: { title: "List", tool_name: "ls", tool_args: {} },
          output: "ok",
        },
      ],
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([message])
  })

  it("removes empty assistant messages after dropping incomplete tools", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-call_tool",
          toolCallId: "call-1",
          state: "input-streaming",
          input: { title: "List" },
        },
      ],
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([])
  })

  it("drops invalid UI messages after sanitizing", async () => {
    const messages = [
      {
        id: "bad",
        role: "assistant",
        parts: [{ type: "text" }],
      },
      {
        id: "good",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ] as unknown as UIMessage[]

    expect(await sanitizeAndValidateMessages(messages)).toEqual([messages[1]])
  })
})
