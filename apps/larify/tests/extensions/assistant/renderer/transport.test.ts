import type { UIMessageChunk } from "ai"
import { describe, expect, it } from "vitest"
import {
  createToolChunkFilterState,
  filterToolChunk,
} from "../../../../src/extensions/assistant/renderer/lib/transport"

const filter = (chunks: UIMessageChunk[]): UIMessageChunk[] => {
  const state = createToolChunkFilterState()
  return chunks.flatMap((chunk) => filterToolChunk(chunk, state))
}

describe("assistant transport tool chunk filtering", () => {
  it("buffers valid top-level tool chunks until input is available", () => {
    const start: UIMessageChunk = {
      type: "tool-input-start",
      toolCallId: "tool-1",
      toolName: "call_tool",
    }
    const delta: UIMessageChunk = {
      type: "tool-input-delta",
      toolCallId: "tool-1",
      inputTextDelta: '{"tool_name"',
    }
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "call_tool",
      input: { tool_name: "glob", tool_args: {} },
    }

    expect(filter([start, delta])).toEqual([])
    expect(filter([start, delta, available])).toEqual([start, delta, available])
  })

  it("suppresses direct calls to non-top-level tools", () => {
    const start: UIMessageChunk = {
      type: "tool-input-start",
      toolCallId: "tool-1",
      toolName: "glob",
    }
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "glob",
      input: { pattern: "*.ts" },
    }
    const error: UIMessageChunk = {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "AI_NoSuchToolError",
    }

    expect(filter([start, available, error])).toEqual([])
  })

  it("suppresses tool input parse and validation errors", () => {
    const start: UIMessageChunk = {
      type: "tool-input-start",
      toolCallId: "tool-1",
      toolName: "call_tool",
    }
    const inputError: UIMessageChunk = {
      type: "tool-input-error",
      toolCallId: "tool-1",
      toolName: "call_tool",
      input: '{"tool_name":',
      errorText: "AI_JSONParseError",
    }
    const outputError: UIMessageChunk = {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "AI_InvalidToolInputError",
    }

    expect(filter([start, inputError, outputError])).toEqual([])
  })

  it("keeps execution errors after a tool call has been released", () => {
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "call_tool",
      input: { tool_name: "write_terminal", tool_args: {} },
    }
    const outputError: UIMessageChunk = {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "Terminal failed",
    }

    expect(filter([available, outputError])).toEqual([available, outputError])
  })
})
