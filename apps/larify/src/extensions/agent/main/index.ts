import { ipcMain } from "electron"
import { convertToModelMessages, type UIMessage } from "ai"
import type { Extension } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { runAgent } from "./agent"
import { ToolRegistry } from "./registry"
import { buildMetaTools, buildRepairToolCall, metaToolDisplays } from "./meta-tools"
import { buildSystemPrompt } from "./system-prompt"

interface RunRequest {
  runId: string
  sessionId: string
  messages: UIMessage[]
}

const extension: Extension = {
  activate(app, context) {
    const controllers = new Map<string, AbortController>()

    ipcMain.handle("agent:tool-displays", () => {
      const registry = new ToolRegistry(app.getAll<Toolkit>("tool"))
      return { ...metaToolDisplays, ...registry.listToolDisplays() }
    })

    ipcMain.handle("agent:run", async (event, { runId, sessionId, messages }: RunRequest) => {
      const controller = new AbortController()
      controllers.set(runId, controller)
      try {
        const registry = new ToolRegistry(app.getAll<Toolkit>("tool"))
        const modelMessages = await convertToModelMessages(messages)
        const reader = runAgent({
          messages: modelMessages,
          buildTools: (writer) => buildMetaTools(registry, { sessionId }, writer),
          repairToolCall: buildRepairToolCall(registry),
          abortSignal: controller.signal,
          system: buildSystemPrompt(registry),
        }).getReader()
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
        ipcMain.removeHandler("agent:tool-displays")
        ipcMain.removeHandler("agent:run")
        ipcMain.removeHandler("agent:cancel")
      },
    })
  },
}

export default extension
