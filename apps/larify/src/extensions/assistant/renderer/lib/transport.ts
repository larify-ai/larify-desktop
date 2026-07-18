import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"

const topLevelTools = new Set(["list_tools", "read_tools", "call_tool"])

interface ToolChunkFilterState {
  pending: Map<string, UIMessageChunk[]>
  waitingForReady: Set<string>
  released: Set<string>
  suppressed: Set<string>
}

export function createToolChunkFilterState(): ToolChunkFilterState {
  return {
    pending: new Map(),
    waitingForReady: new Set(),
    released: new Set(),
    suppressed: new Set(),
  }
}

function chunkToolCallId(chunk: UIMessageChunk): string | null {
  if (chunk.type === "data-tool-ready") {
    const id = (chunk as { id?: unknown }).id
    return typeof id === "string" ? id : null
  }
  if (
    chunk.type === "tool-input-start" ||
    chunk.type === "tool-input-delta" ||
    chunk.type === "tool-input-available" ||
    chunk.type === "tool-input-error" ||
    chunk.type === "tool-output-available" ||
    chunk.type === "tool-output-error" ||
    chunk.type === "tool-output-denied" ||
    chunk.type === "tool-approval-request"
  ) {
    return chunk.toolCallId
  }
  return null
}

function isPendingToolChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === "tool-input-start" || chunk.type === "tool-input-delta"
}

function flushPending(state: ToolChunkFilterState, toolCallId: string): UIMessageChunk[] {
  const chunks = state.pending.get(toolCallId) ?? []
  state.pending.delete(toolCallId)
  return chunks
}

export function filterToolChunk(
  chunk: UIMessageChunk,
  state: ToolChunkFilterState,
): UIMessageChunk[] {
  const toolCallId = chunkToolCallId(chunk)
  if (!toolCallId) return [chunk]
  if (state.suppressed.has(toolCallId)) return []

  if (isPendingToolChunk(chunk)) {
    const chunks = state.pending.get(toolCallId) ?? []
    chunks.push(chunk)
    state.pending.set(toolCallId, chunks)
    return []
  }

  if (chunk.type === "tool-input-error") {
    state.suppressed.add(toolCallId)
    state.pending.delete(toolCallId)
    state.waitingForReady.delete(toolCallId)
    return []
  }

  if (chunk.type === "tool-input-available") {
    if (!topLevelTools.has(chunk.toolName)) {
      state.suppressed.add(toolCallId)
      state.pending.delete(toolCallId)
      state.waitingForReady.delete(toolCallId)
      return []
    }
    const chunks = state.pending.get(toolCallId) ?? []
    chunks.push(chunk)
    state.pending.set(toolCallId, chunks)
    if (chunk.toolName === "call_tool") {
      state.waitingForReady.add(toolCallId)
      return []
    }
    state.released.add(toolCallId)
    return flushPending(state, toolCallId)
  }

  if (chunk.type === "data-tool-ready") {
    if (!state.waitingForReady.has(toolCallId)) return []
    state.waitingForReady.delete(toolCallId)
    state.released.add(toolCallId)
    return flushPending(state, toolCallId)
  }

  if (state.waitingForReady.has(toolCallId)) {
    if (chunk.type === "tool-output-error") {
      state.waitingForReady.delete(toolCallId)
      state.suppressed.add(toolCallId)
      state.pending.delete(toolCallId)
      return []
    }
    return []
  }

  if (!state.released.has(toolCallId)) return []
  return [chunk]
}

export const ipcTransport: ChatTransport<UIMessage> = {
  async sendMessages({ chatId, messages, abortSignal }) {
    const runId = crypto.randomUUID()
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let closed = false
        const filterState = createToolChunkFilterState()
        const offs: Array<() => void> = []
        const finish = (): void => {
          if (closed) return
          closed = true
          controller.close()
          offs.forEach((off) => off())
        }

        offs.push(
          window.bridge.on(`agent:chunk:${runId}`, (c) => {
            const chunk = c as UIMessageChunk
            for (const filtered of filterToolChunk(chunk, filterState)) {
              controller.enqueue(filtered)
            }
          }),
        )
        offs.push(window.bridge.on(`agent:end:${runId}`, finish))

        if (abortSignal) {
          const onAbort = (): void => {
            void window.bridge.invoke("agent:cancel", runId)
            finish()
          }
          abortSignal.addEventListener("abort", onAbort)
          offs.push(() => abortSignal.removeEventListener("abort", onAbort))
        }

        void window.bridge.invoke("agent:run", { runId, sessionId: chatId, messages })
      },
    })
  },
  async reconnectToStream() {
    return null
  },
}
