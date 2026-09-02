import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import type { UIMessage } from 'ai'
import { openDatabase, transaction } from '../sqlite'
import type { Disposable } from '@shared/infra/disposable'

export interface Session {
  id: string
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
}

export interface SessionNavigationItem {
  id: string
  index: number
  promptPreview: string
  responsePreview?: string
}

function previewText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
    .slice(0, 2_000)
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

  loadMessages(id: string): UIMessage[] {
    const messages = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND messages.position >= COALESCE(sessions.start, -1)
         ORDER BY messages.position`
      )
      .all(id)
    return messages.map(({ value }) => JSON.parse(value as string) as UIMessage)
  }

  // reset_context 续写时，模型输入被 sessions.start 截断（loadMessages 只返回 compaction 及其后），
  // 末尾是 compaction user → AI SDK 判定新消息、不复用 reset 前 assistant id（UI 多一条「已完成」）。
  // 这里只读截断前最后一条 assistant（单条，非全量），供 UI 消息身份判定并入，使 reset 前后合并成
  // 一条。仅取一条，性能开销可忽略，不影响模型输入（模型输入仍用 loadMessages 截断版，压缩保留）。
  loadLastAssistantBeforeStart(id: string): UIMessage | undefined {
    const row = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND messages.position < COALESCE(sessions.start, 9223372036854775807)
           AND json_extract(messages.value, '$.role') = 'assistant'
         ORDER BY messages.position DESC
         LIMIT 1`
      )
      .get(id)
    return row ? (JSON.parse(row.value as string) as UIMessage) : undefined
  }

  loadVisibleMessages(id: string, offset = 0, limit = 50): UIMessage[] {
    const messages = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND (sessions.start IS NULL OR messages.position <> sessions.start)
         ORDER BY messages.position ASC LIMIT ? OFFSET ?`
      )
      .all(id, limit, offset)
    return messages.map(({ value }) => JSON.parse(value as string) as UIMessage)
  }

  countMessages(id: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND (sessions.start IS NULL OR messages.position <> sessions.start)`
      )
      .get(id)
    return Number(row?.count ?? 0)
  }

  loadNavigationIndex(id: string, beforeIndex?: number, limit = 50): SessionNavigationItem[] {
    const messageCount = this.countMessages(id)
    const itemLimit = Number.isFinite(limit) ? Math.min(50, Math.max(0, Math.trunc(limit))) : 50
    if (itemLimit === 0) return []
    let cursor = Number.isFinite(beforeIndex)
      ? Math.min(Math.max(0, Math.trunc(beforeIndex!)), messageCount)
      : messageCount
    const items: SessionNavigationItem[] = []
    let responsePreview: string | undefined
    while (cursor > 0 && items.length < itemLimit) {
      const start = Math.max(0, cursor - 100)
      const messages = this.loadVisibleMessages(id, start, cursor - start)
      for (let localIndex = messages.length - 1; localIndex >= 0; localIndex -= 1) {
        const message = messages[localIndex]
        if (message.role === 'user') {
          const metadata = message.metadata as Record<string, unknown> | undefined
          if (metadata?.compaction === true) {
            responsePreview = undefined
            continue
          }
          items.push({
            id: message.id,
            index: start + localIndex,
            promptPreview: previewText(message).replace(/\s+/g, ' ') || '用户消息',
            responsePreview
          })
          responsePreview = undefined
          if (items.length === itemLimit) break
          continue
        }
        if (message.role !== 'assistant' || responsePreview) continue
        responsePreview = previewText(message) || undefined
      }
      cursor = start
    }
    return items.reverse()
  }

  hasSession(id: string): boolean {
    return this.database.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id) !== undefined
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
      const current = this.database
        .prepare('SELECT start FROM sessions WHERE id = ?')
        .get(sessionId)
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
    return this.database
      .prepare(
        `SELECT id, title, cwd,
                created_at AS createdAt,
                updated_at AS updatedAt
         FROM sessions WHERE cwd = ?
         ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(cwd, limit, offset) as Array<Session & Record<string, SQLOutputValue>>
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
}
