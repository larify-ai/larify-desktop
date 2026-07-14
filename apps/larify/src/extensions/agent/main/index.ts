import { ipcMain } from "electron"
import { convertToModelMessages, type UIMessage } from "ai"
import { z } from "zod"
import type { Extension } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { runAgent } from "./agent"
import { ToolRegistry } from "./registry"
import { buildMetaTools, buildRepairToolCall } from "./meta-tools"
import { buildSystemPrompt } from "./system-prompt"

interface RunRequest {
  runId: string
  sessionId: string
  messages: UIMessage[]
}

const demoKit: Toolkit = {
  name: "demo",
  description: "Temporary demo tools",
  tools: [
    {
      name: "echo",
      description: "Echo back the given text",
      inputSchema: z.object({ text: z.string() }),
      execute: async (args) => (args as { text: string }).text,
    },
  ],
}

const extension: Extension = {
  activate(app, context) {
    app.register("tool", "demo", demoKit)

    const controllers = new Map<string, AbortController>()

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
        ipcMain.removeHandler("agent:run")
        ipcMain.removeHandler("agent:cancel")
      },
    })
  },
}

export default extension
