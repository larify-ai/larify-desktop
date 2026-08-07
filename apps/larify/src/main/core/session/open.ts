import { backgroundSessionDatabasePath, sessionDatabasePath } from '../../utils/app-paths'
import { SessionStore } from './store'
import { registerSessionHandlers } from './ipc'
import { defineService } from '../../infra/registry'
import type { Application } from '../../app/application'

export const sessionToken = defineService()
export const backgroundSessionToken = defineService()
const sessionHandlersToken = defineService()

export function registerSession(application: Application): void {
  const store = new SessionStore(sessionDatabasePath())
  const backgroundStore = new SessionStore(backgroundSessionDatabasePath())
  const handlers = registerSessionHandlers(store)
  application.registry.register(sessionToken, store)
  application.registry.register(backgroundSessionToken, backgroundStore)
  application.registry.register(sessionHandlersToken, handlers)
}
