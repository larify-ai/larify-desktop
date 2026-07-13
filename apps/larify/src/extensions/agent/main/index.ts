import { ipcMain } from "electron"
import { convertToModelMessages, type UIMessage } from "ai"
import type { Extension } from "kernel"
import { runAgent } from "./agent"

interface RunRequest {
  runId: string
  messages: UIMessage[]
}

const extension: Extension = {
  activate(_app, context) {
    const controllers = new Map<string, AbortController>()

    ipcMain.handle("agent:run", async (event, { runId, messages }: RunRequest) => {
      const controller = new AbortController()
      controllers.set(runId, controller)
      try {
        const modelMessages = await convertToModelMessages(messages)
        const reader = runAgent(modelMessages, undefined, undefined, controller.signal).getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          event.sender.send(`agent:chunk:${runId}`, value)
        }
      } catch (e) {
        console.error("[agent:run]", e)
      } finally {
        controllers.delete(runId)
        event.sender.send(`agent:end:${runId}`)
      }
    })

    ipcMain.handle("agent:cancel", (_e, runId: string) => {
      controllers.get(runId)?.abort()
    })

    context.subscriptions.push({
      dispose: () => {
        ipcMain.removeHandler("agent:run")
        ipcMain.removeHandler("agent:cancel")
      },
    })
  },
}

export default extension
