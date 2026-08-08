import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { AgentModelConfig } from '../../../../../main/core/model/config'

function openAgentStream(
  sessionId: string,
  signal: AbortSignal | undefined,
  start: () => Promise<void>
): ReadableStream<UIMessageChunk> {
  let finished = false
  let cleanup: Array<() => void> = []

  const dispose = (): void => {
    cleanup.forEach((dispose) => dispose())
    cleanup = []
  }

  return new ReadableStream({
    start(controller) {
      let started = Promise.resolve()
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
        window.bridge.on(`agent:end:${sessionId}`, () => void started.then(() => finish(), finish)),
        window.bridge.on(
          `agent:error:${sessionId}`,
          (error) => void started.then(() => finish(error), finish)
        )
      )

      const cancel = (): void => {
        void window.bridge.invoke('agent:cancel', sessionId).catch(finish)
      }
      if (signal?.aborted) return finish()
      if (signal) {
        signal.addEventListener('abort', cancel)
        cleanup.push(() => signal.removeEventListener('abort', cancel))
      }

      started = Promise.resolve().then(start)
      void started.catch(finish)
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
  onSaved?: () => Promise<void>
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ chatId, messages, abortSignal }) {
      const message = messages.at(-1)
      if (!message) throw new Error('A message is required.')
      const cwd = getCwd()
      const modelConfig = getModelConfig()

      return openAgentStream(chatId, abortSignal, async () => {
        const saved = (await window.bridge.invoke('attachment:save', chatId, message)) ?? message
        await window.bridge.invoke('agent:send', {
          sessionId: chatId,
          message: saved,
          cwd,
          modelConfig
        })
        await onSaved?.()
      })
    },

    async reconnectToStream() {
      return null
    }
  }
}
