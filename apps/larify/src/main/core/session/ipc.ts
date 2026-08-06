import { ipcMain } from 'electron'
import type { Disposable } from '../../infra/disposable'
import { createSessionQueries } from './queries'
import type { SessionStore } from './store'

export function registerSessionHandlers(store: SessionStore): Disposable {
  const queries = createSessionQueries(store)
  for (const [channel, query] of Object.entries(queries)) ipcMain.handle(channel, query)

  return {
    dispose() {
      for (const channel of Object.keys(queries)) ipcMain.removeHandler(channel)
    }
  }
}
