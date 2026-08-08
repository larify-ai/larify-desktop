import { larifyPath } from '../../utils/app-paths'
import type { SessionStore } from './store'

export interface SessionQueries {
  'session:cwds': () => ReturnType<SessionStore['listCwds']>
  'session:list': (
    event: unknown,
    cwd: string,
    offset?: number,
    limit?: number
  ) => ReturnType<SessionStore['listSessions']>
  'session:msgs': (
    event: unknown,
    id: string,
    offset?: number,
    limit?: number
  ) => ReturnType<SessionStore['loadVisibleMessages']>
  'session:msg-count': (event: unknown, id: string) => ReturnType<SessionStore['countMessages']>
}

export function createSessionQueries(store: SessionStore): SessionQueries {
  const defaultCwd = larifyPath('workspace')
  return {
    'session:cwds': () => [
      ...new Set(store.listCwds().map((cwd) => (cwd === defaultCwd ? '' : cwd)))
    ],
    'session:list': (_event: unknown, cwd: string, offset?: number, limit?: number) =>
      store.listSessions(cwd || defaultCwd, offset, limit).map((session) => ({
        ...session,
        cwd: session.cwd === defaultCwd ? '' : session.cwd
      })),
    'session:msgs': (_event: unknown, id: string, offset?: number, limit?: number) =>
      store.loadVisibleMessages(id, offset, limit),
    'session:msg-count': (_event: unknown, id: string) => store.countMessages(id)
  }
}
