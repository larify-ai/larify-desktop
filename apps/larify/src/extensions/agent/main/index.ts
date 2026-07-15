import { ipcMain } from "electron"
import { convertToModelMessages, type UIMessage } from "ai"
import type { Extension } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { runAgent } from "./agent"
import { ToolRegistry } from "./registry"
import { buildMetaTools, buildRepairToolCall, metaToolDisplays } from "./meta-tools"
import { buildSystemPrompt } from "./system-prompt"
import { createSessionStore } from "./session-store"

interface RunRequest {
  runId: string
  sessionId: string
  messages: UIMessage[]
}

const extension: Extension = {
  activate(app, context) {
    const controllers = new Map<string, AbortController>()
    const sessions = createSessionStore()

    ipcMain.handle("agent:tool-displays", () => {
      const registry = new ToolRegistry(app.getAll<Toolkit>("tool"))
      return { ...metaToolDisplays, ...registry.listToolDisplays() }
    })

    ipcMain.handle("agent:session-load", (_event, sessionId: string) => {
      return sessions.loadSession(sessionId)
    })

    ipcMain.handle("agent:session-save", (_event, sessionId: string, messages: UIMessage[]) => {
      return sessions.saveSession(sessionId, messages)
    })

    ipcMain.handle("agent:session-list", () => {
      return sessions.listSessions()
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
        for (const controller of controllers.values()) controller.abort()
        controllers.clear()
        ipcMain.removeHandler("agent:tool-displays")
        ipcMain.removeHandler("agent:session-load")
        ipcMain.removeHandler("agent:session-save")
        ipcMain.removeHandler("agent:session-list")
        ipcMain.removeHandler("agent:run")
        ipcMain.removeHandler("agent:cancel")
      },
    })
  },
}

export default extension
