import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import type { UIMessage } from 'ai'
import { openDatabase, transaction } from '../sqlite'
import type { Disposable } from '../../infra/disposable'

export interface Session {
  id: string
  title: string
  cwd: string
  start?: number
  messages?: UIMessage[]
  createdAt?: number
  updatedAt?: number
}

interface SessionRow extends Record<string, SQLOutputValue> {
  id: string
  title: string
  cwd: string
  start: number | null
  created_at: number
  updated_at: number
}

export class SessionStore implements Disposable {
  private readonly database: DatabaseSync

  constructor(path: string) {
    this.database = openDatabase(path)
    this.database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        start INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        position INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        value TEXT NOT NULL,
        UNIQUE (session_id, id)
      );

      CREATE INDEX IF NOT EXISTS sessions_by_cwd
      ON sessions(cwd, updated_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS messages_by_session
      ON messages(session_id, position DESC);
    `)
  }

  loadSession(id: string, offset = 0, limit = 50): Session | null {
    const row = this.getSession(id)
    if (!row) return null

    const messages = this.database
      .prepare(
        `SELECT value FROM messages
         WHERE session_id = ?
           AND (? IS NULL OR position <> ?)
         ORDER BY position DESC LIMIT ? OFFSET ?`
      )
      .all(id, row.start, row.start, limit, offset)
    return {
      ...toSession(row),
      messages: messages.reverse().map(({ value }) => JSON.parse(value as string) as UIMessage)
    }
  }

  loadMessages(id: string): UIMessage[] {
    const session = this.getSession(id)
    if (!session) return []
    const messages = this.database
      .prepare(
        `SELECT value FROM messages
         WHERE session_id = ? AND position >= ?
         ORDER BY position`
      )
      .all(id, session.start ?? -1)
    return messages.map(({ value }) => JSON.parse(value as string) as UIMessage)
  }

  createSession(session: Pick<Session, 'id' | 'title' | 'cwd'>): void {
    const now = Date.now()
    this.database
      .prepare(
        `INSERT INTO sessions (id, title, cwd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(session.id, session.title, session.cwd, now, now)
  }

  renameSession(id: string, title: string): void {
    this.database
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id)
  }

  saveMessages(sessionId: string, messages: UIMessage[]): void {
    if (!messages.length) return
    const save = this.database.prepare(
      `INSERT INTO messages (session_id, id, value)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET value = excluded.value
       WHERE messages.value <> excluded.value`
    )
    transaction(this.database, () => {
      for (const message of messages) save.run(sessionId, message.id, JSON.stringify(message))
      this.database
        .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
        .run(Date.now(), sessionId)
    })
  }

  saveStart(sessionId: string, message: UIMessage): void {
    transaction(this.database, () => {
      const current = this.getSession(sessionId)
      if (!current) throw new Error(`Session not found: ${sessionId}`)
      if (current.start !== null) {
        this.database
          .prepare('DELETE FROM messages WHERE session_id = ? AND position = ?')
          .run(sessionId, current.start)
      }
      const result = this.database
        .prepare(
          `INSERT INTO messages (session_id, id, value)
           VALUES (?, ?, ?)`
        )
        .run(sessionId, message.id, JSON.stringify(message))
      const position = Number(result.lastInsertRowid)
      this.database
        .prepare('UPDATE sessions SET start = ?, updated_at = ? WHERE id = ?')
        .run(position, Date.now(), sessionId)
    })
  }

  listSessions(cwd: string, offset = 0, limit = 10): Session[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, cwd, start, created_at, updated_at
         FROM sessions WHERE cwd = ?
         ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(cwd, limit, offset) as SessionRow[]
    return rows.map(toSession)
  }

  listCwds(): string[] {
    const rows = this.database
      .prepare('SELECT cwd FROM sessions GROUP BY cwd ORDER BY MAX(updated_at) DESC, cwd')
      .all()
    return rows.map(({ cwd }) => cwd as string)
  }

  dispose(): void {
    this.database.close()
  }

  private getSession(id: string): SessionRow | undefined {
    return this.database
      .prepare(
        `SELECT id, title, cwd, start, created_at, updated_at
         FROM sessions WHERE id = ?`
      )
      .get(id) as SessionRow | undefined
  }
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    cwd: row.cwd,
    start: row.start ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
