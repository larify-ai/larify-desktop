import { ipcMain } from 'electron'
import type { Disposable } from '../../infra/disposable'
import { errorMessage } from '../../utils/error'
import { Agent, type AgentInput } from './agent'

export function registerAgentHandlers(agent: Agent): Disposable {
  ipcMain.handle('agent:send', (event, input: AgentInput) => {
    const channel = input.sessionId
    return agent.send(input, {
      chunk: (chunk) => event.sender.send(`agent:chunk:${channel}`, chunk),
      error: (error) => event.sender.send(`agent:error:${channel}`, errorMessage(error)),
      end: () => event.sender.send(`agent:end:${channel}`)
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
