import { ipcMain } from 'electron'
import type { Disposable } from '@shared/infra/disposable'
import { errorMessage } from '../../utils/error'
import { Agent, type AgentInput } from './agent'

export function registerAgentHandlers(agent: Agent): Disposable {
  ipcMain.handle('agent:send', (event, input: AgentInput) => {
    const channel = input.sessionId
    const send = (name: string, ...args: unknown[]): void => {
      if (!event.sender.isDestroyed()) event.sender.send(name, ...args)
    }
    return agent.send(input, {
      chunk: (chunk) => send(`agent:chunk:${channel}`, chunk),
      error: (error) => send(`agent:error:${channel}`, errorMessage(error)),
      end: () => send(`agent:end:${channel}`)
    })
  })

  ipcMain.handle('agent:cancel', (_event, sessionId: string) => agent.cancel(sessionId))

  return {
    dispose() {
      ipcMain.removeHandler('agent:send')
      ipcMain.removeHandler('agent:cancel')
    }
  }
}
