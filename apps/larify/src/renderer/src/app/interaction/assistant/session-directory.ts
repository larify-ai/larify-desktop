export interface SessionDirectoryItem {
  id: string
  title: string
  cwd: string
}

export interface SessionDirectoryGroup {
  cwd: string
  sessions: SessionDirectoryItem[]
  hasMore: boolean
}

const sessionPageSize = 5

export async function loadSessionDirectory(): Promise<SessionDirectoryGroup[]> {
  const value = await window.bridge.invoke('session:cwds').catch(() => [])
  const cwds = Array.isArray(value)
    ? value.filter((cwd): cwd is string => typeof cwd === 'string')
    : []
  const ordered = [...new Set([...cwds.filter(Boolean), ''])]

  return Promise.all(
    ordered.map(async (cwd) => {
      try {
        return { cwd, ...(await loadSessionPage(cwd)) }
      } catch {
        return { cwd, sessions: [], hasMore: false }
      }
    })
  )
}

export async function loadSessionPage(
  cwd: string,
  offset = 0
): Promise<Pick<SessionDirectoryGroup, 'sessions' | 'hasMore'>> {
  const value = await window.bridge.invoke('session:list', cwd, offset, sessionPageSize + 1)
  const sessions = Array.isArray(value) ? value.filter(isSession) : []
  return {
    sessions: sessions.slice(0, sessionPageSize),
    hasMore: sessions.length > sessionPageSize
  }
}

function isSession(value: unknown): value is SessionDirectoryItem {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>
  return (
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    typeof session.cwd === 'string'
  )
}
