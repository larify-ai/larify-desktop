import { ipcMain } from "electron"
import { convertToModelMessages, type UIMessage } from "ai"
import type { Extension } from "@shared/extension"
import { runAgentUIStream } from "./agent"
import { createSessionStore } from "./session-store"
import { sanitizeAndValidateMessages } from "./message-sanitizer"
import { larifyWorkspacePath } from "../../../main/utils/app-paths"
import { defaultModelConfig, isAgentModelConfig, type AgentModelConfig } from "../shared/model"
import { createAgentRuntime } from "./runtime"

interface RunRequest {
  runId: string
  sessionId: string
  messages: UIMessage[]
  cwd?: string
  modelConfig?: AgentModelConfig
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

    ipcMain.handle("agent:session-load", async (_event, sessionId: string) => {
      const result = await sessions.loadSession(sessionId)
      const defaultCwd = larifyWorkspacePath()
      return {
        messages: await sanitizeAndValidateMessages(result?.messages ?? []),
        cwd: result?.cwd || defaultCwd,
        defaultCwd,
      }
    })

    ipcMain.handle(
      "agent:session-save",
      async (_event, sessionId: string, messages: UIMessage[], cwd: string) => {
        return sessions.saveSession(sessionId, await sanitizeAndValidateMessages(messages), cwd)
      },
    )

    ipcMain.handle("agent:session-list", () => {
      return sessions.listSessions()
    })

    ipcMain.handle(
      "agent:run",
      async (event, { runId, sessionId, messages, cwd: requestCwd, modelConfig }: RunRequest) => {
        const controller = new AbortController()
        controllers.set(runId, controller)
        try {
          const validMessages = await sanitizeAndValidateMessages(messages)
          const modelMessages = await convertToModelMessages(prepareMessagesForModel(validMessages))
          const cwd = requestCwd || larifyWorkspacePath()
          app.emit("workspace:open", cwd)
          const config = isAgentModelConfig(modelConfig) ? modelConfig : defaultModelConfig
          const reader = runAgentUIStream({
            messages: modelMessages,
            abortSignal: controller.signal,
            ...createAgentRuntime({ app, cwd, sessionId, modelConfig: config }),
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
      },
    )

    ipcMain.handle("agent:cancel", (_e, runId: string) => {
      controllers.get(runId)?.abort()
    })

    context.subscriptions.push({
      dispose: () => {
        for (const controller of controllers.values()) controller.abort()
        controllers.clear()
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
