import { ipcMain } from 'electron'
import { convertToModelMessages, type UIMessage } from 'ai'
import { runAgentUIStream } from '../../../main/core/agent'
import { sanitizeAndValidateMessages } from '../../../main/core/agent/message-sanitizer'
import { createAgentRuntime } from '../../../main/core/agent/runtime'
import type { ExtensionHost } from '../../../main/core/extension'
import { larifyWorkspacePath } from '../../../main/utils/app-paths'
import type { App, Disposable } from '../../../shared/types'
import { defaultModelConfig, isAgentModelConfig, type AgentModelConfig } from '../shared/model'
import { createMetaTools, type ContextSearch } from './meta-tools'

interface RunRequest {
  runId: string
  sessionId: string
  messages: UIMessage[]
  cwd?: string
  modelConfig?: AgentModelConfig
}

function prepareMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message
    const paths = message.parts
      .filter((part) => part.type === 'file')
      .map((file) => file.url)
      .filter(Boolean)
    if (paths.length === 0) return message

    return {
      ...message,
      parts: [
        {
          type: 'text' as const,
          text: `Attached paths:\n${paths.map((path) => `- ${path}`).join('\n')}\n\n`
        },
        ...message.parts.filter((part) => part.type !== 'file')
      ]
    }
  })
}

export function registerRunHandlers(app: App, template: string): Disposable {
  const controllers = new Map<string, AbortController>()

  ipcMain.handle(
    'agent:run',
    async (event, { runId, sessionId, messages, cwd: requestedCwd, modelConfig }: RunRequest) => {
      const controller = new AbortController()
      controllers.set(runId, controller)
      try {
        const validMessages = await sanitizeAndValidateMessages(messages)
        const modelMessages = await convertToModelMessages(prepareMessages(validMessages))
        const cwd = requestedCwd || larifyWorkspacePath()
        app.emit('workspace:open', cwd)
        const config = isAgentModelConfig(modelConfig) ? modelConfig : defaultModelConfig
        const host = app.get<ExtensionHost>('service', 'extension-host')
        if (!host) throw new Error('Extension host is unavailable.')
        const runtime = await createAgentRuntime({
          app,
          cwd,
          sessionId,
          modelConfig: config,
          template,
          metaTools: createMetaTools(host, app.get<ContextSearch>('service', 'context'))
        })
        const reader = runAgentUIStream({
          messages: modelMessages,
          abortSignal: controller.signal,
          ...runtime
        }).getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          event.sender.send(`agent:chunk:${runId}`, value)
        }
      } catch (error) {
        console.error('[agent:run]', error)
      } finally {
        controllers.delete(runId)
        event.sender.send(`agent:end:${runId}`)
      }
    }
  )

  ipcMain.handle('agent:cancel', (_event, runId: string) => controllers.get(runId)?.abort())

  return {
    dispose() {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      ipcMain.removeHandler('agent:run')
      ipcMain.removeHandler('agent:cancel')
    }
  }
}
