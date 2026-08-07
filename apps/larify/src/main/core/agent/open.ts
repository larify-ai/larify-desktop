import { defineService } from '../../infra/registry'
import type { Application } from '../../app/application'
import { sessionToken, type SessionStore } from '../session'
import { Agent } from './agent'
import { registerAgentHandlers } from './ipc'

export const agentToken = defineService()
const agentHandlersToken = defineService()

export function registerAgent(application: Application): void {
  const sessions = application.registry.get<SessionStore>(sessionToken)
  if (!sessions) throw new Error('Session service is unavailable.')
  const agent = new Agent(sessions)
  application.registry.register(agentToken, agent)
  application.registry.register(agentHandlersToken, registerAgentHandlers(agent))
}
