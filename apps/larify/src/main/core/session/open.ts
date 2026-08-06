import { sessionDatabasePath } from '../../utils/app-paths'
import { SessionStore } from './store'
import { registerSessionHandlers } from './ipc'
import { defineService } from '../../infra/registry'
import type { Application } from '../../app/application'

export const sessionToken = defineService()

export function registerSession(application: Application): void {
  const store = new SessionStore(sessionDatabasePath())
  const handlers = registerSessionHandlers(store)
  application.registry.register(sessionToken, {
    async dispose() {
      await handlers.dispose()
      store.close()
    }
  })
}
