import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { AgentModelConfig } from '../../../../../main/core/model/config'

function openAgentStream(
  sessionId: string,
  signal: AbortSignal | undefined,
  onTitle: ((title: string) => void) | undefined,
  start: (cancelled: () => boolean) => Promise<void>
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
        window.bridge.on(`agent:title:${sessionId}`, (title) => {
          if (!finished && typeof title === 'string') onTitle?.(title)
        }),
        window.bridge.on(`agent:end:${sessionId}`, () => finish()),
        window.bridge.on(`agent:error:${sessionId}`, finish)
      )

      const cancel = (): void => {
        void window.bridge.invoke('agent:cancel', sessionId).then(() => finish(), finish)
      }
      if (signal?.aborted) return finish()
      if (signal) {
        signal.addEventListener('abort', cancel)
        cleanup.push(() => signal.removeEventListener('abort', cancel))
      }

      void Promise.resolve()
        .then(() => start(() => finished || signal?.aborted === true))
        .catch(finish)
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
  onSaved?: () => Promise<void>,
  onTitle?: (title: string) => void
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ chatId, messages, abortSignal }) {
      const message = messages.at(-1)
      if (!message) throw new Error('A message is required.')
      const cwd = getCwd()
      const modelConfig = getModelConfig()

      return openAgentStream(chatId, abortSignal, onTitle, async (cancelled) => {
        const saved = (await window.bridge.invoke('attachment:save', chatId, message)) ?? message
        if (cancelled()) return
        await window.bridge.invoke('agent:send', {
          sessionId: chatId,
          message: saved,
          cwd,
          modelConfig
        })
        if (onSaved)
          void Promise.resolve()
            .then(onSaved)
            .catch(() => undefined)
      })
    },

    async reconnectToStream() {
      return null
    }
  }
}
