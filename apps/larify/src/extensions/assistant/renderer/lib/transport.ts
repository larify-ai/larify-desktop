import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"

export const ipcTransport: ChatTransport<UIMessage> = {
  async sendMessages({ chatId, messages, abortSignal }) {
    const runId = crypto.randomUUID()
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let closed = false
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
            controller.enqueue(chunk)
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
