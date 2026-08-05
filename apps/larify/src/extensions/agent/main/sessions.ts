import { ipcMain } from 'electron'
import type { UIMessage } from 'ai'
import { sanitizeAndValidateMessages } from '../../../main/core/agent/message-sanitizer'
import type { SessionStore } from '../../../main/core/session'
import { larifyWorkspacePath } from '../../../main/utils/app-paths'
import type { App, Disposable } from '../../../shared/types'

function sessionTitle(messages: UIMessage[]): string {
  return (
    messages
      .find(({ role }) => role === 'user')
      ?.parts.find((part) => part.type === 'text')
      ?.text.trim() || 'Untitled'
  )
}

export function registerSessionHandlers(app: App): Disposable {
  const sessions = app.get<SessionStore>('service', 'session')
  if (!sessions) throw new Error('Session service is unavailable.')

  ipcMain.handle('agent:session-load', async (_event, sessionId: string) => {
    const result = await sessions.loadSession(sessionId)
    const defaultCwd = larifyWorkspacePath()
    return {
      messages: await sanitizeAndValidateMessages(result?.messages ?? []),
      cwd: result?.cwd || defaultCwd,
      defaultCwd
    }
  })

  ipcMain.handle(
    'agent:session-save',
    async (_event, sessionId: string, messages: UIMessage[], cwd: string) => {
      const validMessages = await sanitizeAndValidateMessages(messages)
      return sessions.saveSession({
        id: sessionId,
        title: sessionTitle(validMessages),
        cwd,
        messages: validMessages
      })
    }
  )

  ipcMain.handle('agent:session-list', (_event, cwd: string, offset?: number, limit?: number) =>
    sessions.listSessions(cwd, offset, limit)
  )
  ipcMain.handle('agent:session-cwds', () => sessions.listCwds())

  return {
    dispose() {
      ipcMain.removeHandler('agent:session-load')
      ipcMain.removeHandler('agent:session-save')
      ipcMain.removeHandler('agent:session-list')
      ipcMain.removeHandler('agent:session-cwds')
    }
  }
}
