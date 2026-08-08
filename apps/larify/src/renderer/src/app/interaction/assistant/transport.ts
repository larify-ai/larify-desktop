import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { AgentModelConfig } from '../../../../../main/core/model/config'

function openAgentStream(
  sessionId: string,
  signal: AbortSignal | undefined,
  start: () => Promise<unknown>
): ReadableStream<UIMessageChunk> {
  let finished = false
  let cleanup: Array<() => void> = []

  const dispose = (): void => {
    cleanup.forEach((dispose) => dispose())
    cleanup = []
  }

  return new ReadableStream({
    start(controller) {
      const finish = (error?: unknown): void => {
        if (finished) return
        finished = true
        dispose()
        if (error === undefined) controller.close()
        else controller.error(error)
      }

      cleanup.push(
        window.bridge.on(`agent:chunk:${sessionId}`, (chunk) => {
          if (!finished) controller.enqueue(chunk as UIMessageChunk)
        }),
        window.bridge.on(`agent:end:${sessionId}`, () => finish()),
        window.bridge.on(`agent:error:${sessionId}`, (error) => finish(error))
      )

      const cancel = (): void => {
        void window.bridge.invoke('agent:cancel', sessionId).catch(finish)
      }
      if (signal?.aborted) return finish()
      if (signal) {
        signal.addEventListener('abort', cancel)
        cleanup.push(() => signal.removeEventListener('abort', cancel))
      }

      try {
        void start().catch(finish)
      } catch (error) {
        finish(error)
      }
    },

    async cancel() {
      if (finished) return
      finished = true
      dispose()
      await window.bridge.invoke('agent:cancel', sessionId)
    }
  })
}

export function createIpcTransport(
  getCwd: () => string,
  getModelConfig: () => AgentModelConfig,
  onSaved?: () => void
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ chatId, messages, abortSignal }) {
      const message = messages.at(-1)
      if (!message) throw new Error('A message is required.')
      const input = {
        sessionId: chatId,
        message,
        cwd: getCwd(),
        modelConfig: getModelConfig()
      }

      return openAgentStream(chatId, abortSignal, async () => {
        await window.bridge.invoke('agent:send', input)
        onSaved?.()
      })
    },

    async reconnectToStream() {
      return null
    }
  }
}
