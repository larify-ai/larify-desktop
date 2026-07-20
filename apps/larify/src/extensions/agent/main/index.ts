import { ipcMain } from "electron"
import { convertToModelMessages, type UIMessage } from "ai"
import type { Extension } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { runAgent } from "./agent"
import { createToolRegistry } from "./registry"
import { buildMetaTools } from "./meta-tools"
import { buildSystemPrompt } from "./system-prompt"
import { createSessionStore } from "./session-store"
import { sanitizeAndValidateMessages } from "./message-sanitizer"

const metaToolDisplays = {
  list_kits: { title: "搜索工具", icon: "search" },
  read_tools: { title: "读取工具", icon: "search" },
  call_tool: { title: "调用工具", icon: "other" },
}

interface RunRequest {
  runId: string
  sessionId: string
  messages: UIMessage[]
}

function prepareMessagesForModel(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message

    const files = message.parts.filter((part) => part.type === "file")
    const paths = files.map((file) => file.url).filter(Boolean)
    if (paths.length === 0) return message

    return {
      ...message,
      parts: [
        {
          type: "text" as const,
          text: `Attached paths:\n${paths.map((path) => `- ${path}`).join("\n")}\n\n`,
        },
        ...message.parts.filter((part) => part.type !== "file"),
      ],
    }
  })
}

const extension: Extension = {
  activate(app, context) {
    const controllers = new Map<string, AbortController>()
    const sessions = createSessionStore()

    ipcMain.handle("agent:tool-displays", () => {
      const registry = createToolRegistry(app.getAll<Toolkit>("tool"))
      return { ...metaToolDisplays, ...registry.listToolDisplays() }
    })

    ipcMain.handle("agent:session-load", (_event, sessionId: string) => {
      return sessions.loadSession(sessionId).then(sanitizeAndValidateMessages)
    })

    ipcMain.handle("agent:session-save", async (_event, sessionId: string, messages: UIMessage[]) => {
      return sessions.saveSession(sessionId, await sanitizeAndValidateMessages(messages))
    })

    ipcMain.handle("agent:session-list", () => {
      return sessions.listSessions()
    })

    ipcMain.handle("agent:run", async (event, { runId, sessionId, messages }: RunRequest) => {
      const controller = new AbortController()
      controllers.set(runId, controller)
      try {
        const registry = createToolRegistry(app.getAll<Toolkit>("tool"))
        const validMessages = await sanitizeAndValidateMessages(messages)
        const modelMessages = await convertToModelMessages(prepareMessagesForModel(validMessages))
        const reader = runAgent({
          messages: modelMessages,
          buildTools: (writer) => buildMetaTools(registry, { sessionId }, writer),
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
