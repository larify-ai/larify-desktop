import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import type { AgentModelConfig } from "../../../agent/shared/model"

export const createIpcTransport = (
  getCwd: () => string,
  getModelConfig: () => AgentModelConfig,
): ChatTransport<UIMessage> => ({
  async sendMessages({ chatId, messages, abortSignal }) {
    const runId = crypto.randomUUID()
    const cwd = getCwd()
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let finishing = false
        let started = false
        let cancelled = false
        const offs: Array<() => void> = []
        const beginReview = window.bridge
          .invoke("review:begin", runId, cwd)
          .then(() => true)
          .catch((error) => {
            console.error("[review:begin]", error)
            return false
          })
        const finish = async (error?: unknown): Promise<void> => {
          if (finishing) return
          finishing = true
          try {
            const reviewStarted = await beginReview
            if (reviewStarted) {
              try {
                const data = await window.bridge.invoke("review:finish", runId)
                if (data) {
                  controller.enqueue({ type: "data-git-snapshot", data } as UIMessageChunk)
                }
              } catch (reviewError) {
                console.error("[review:finish]", reviewError)
              }
            }
            if (error === undefined) controller.close()
            else controller.error(error)
          } finally {
            offs.forEach((off) => off())
          }
        }
        const fail = (error: unknown): void => void finish(error)

        offs.push(
          window.bridge.on(`agent:chunk:${runId}`, (c) => {
            if (!finishing) {
              controller.enqueue(c as UIMessageChunk)
            }
          }),
        )
        offs.push(window.bridge.on(`agent:end:${runId}`, () => void finish()))

        if (abortSignal) {
          const onAbort = (): void => {
            cancelled = true
            void Promise.resolve()
              .then(() => window.bridge.invoke("agent:cancel", runId))
              .catch((error) => console.error("[agent:cancel]", error))
            if (!started) void finish()
          }
          if (abortSignal.aborted) {
            onAbort()
          } else {
            abortSignal.addEventListener("abort", onAbort)
            offs.push(() => abortSignal.removeEventListener("abort", onAbort))
          }
        }

        void beginReview
          .then(() => {
            if (finishing || cancelled) return
            started = true
            return window.bridge.invoke("agent:run", {
              runId,
              sessionId: chatId,
              messages,
              cwd,
              modelConfig: getModelConfig(),
            })
          })
          .catch(fail)
      },
    })
  },
  async reconnectToStream() {
    return null
  },
})
