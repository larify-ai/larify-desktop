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
  it("buffers call_tool chunks until inner args are validated", () => {
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
    const ready = {
      type: "data-tool-ready",
      id: "tool-1",
      data: { toolName: "glob" },
    } as UIMessageChunk

    expect(filter([start, delta])).toEqual([])
    expect(filter([start, delta, available])).toEqual([])
    expect(filter([start, delta, available, ready])).toEqual([start, delta, available])
  })

  it("releases list_tools when input is available", () => {
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "list_tools",
      input: { title: "查看工具", groups: ["filesystem"] },
    }

    expect(filter([available])).toEqual([available])
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

  it("suppresses inner schema errors before a call_tool is released", () => {
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "call_tool",
      input: { tool_name: "read", tool_args: { path: "wrong" } },
    }
    const outputError: UIMessageChunk = {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "AI_InvalidToolInputError",
    }

    expect(filter([available, outputError])).toEqual([])
  })

  it("keeps execution errors after a tool call has been released", () => {
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "call_tool",
      input: { tool_name: "write_terminal", tool_args: {} },
    }
    const ready = {
      type: "data-tool-ready",
      id: "tool-1",
      data: { toolName: "write_terminal" },
    } as UIMessageChunk
    const outputError: UIMessageChunk = {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "Terminal failed",
    }

    expect(filter([available, ready, outputError])).toEqual([available, outputError])
  })

  it("keeps direct top-level execution errors after release", () => {
    const available: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "list_tools",
      input: { title: "查看工具", groups: ["missing"] },
    }
    const outputError: UIMessageChunk = {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "Toolkit failed",
    }

    expect(filter([available, outputError])).toEqual([available, outputError])
  })
})
