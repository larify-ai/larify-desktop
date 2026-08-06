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
  ) => NonNullable<ReturnType<SessionStore['loadSession']>>['messages']
}

export function createSessionQueries(store: SessionStore): SessionQueries {
  return {
    'session:cwds': () => store.listCwds(),
    'session:list': (_event: unknown, cwd: string, offset?: number, limit?: number) =>
      store.listSessions(cwd, offset, limit),
    'session:msgs': (_event: unknown, id: string, offset?: number, limit?: number) =>
      store.loadSession(id, offset, limit)?.messages ?? []
  }
}
