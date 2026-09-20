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

  /**
   * 模型输入（主链）：排除递归子任务消息（metadata.nested）。
   * 子任务自身的上下文不走这里——它只喂本轮 nest prompt（见 persist.ts）。
   */
  loadMessages(id: string): UIMessage[] {
    const messages = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND messages.position >= COALESCE(sessions.start, -1)
           AND json_extract(messages.value, '$.metadata.nested') IS NOT 1
         ORDER BY messages.position`
      )
      .all(id)
    return messages.map(({ value }) => JSON.parse(value as string) as UIMessage)
  }

  /**
   * 最近一条 assistant（排除递归子任务消息 nested）；`side` 指定相对 reset 游标 `start` 的哪一侧：
   * - `'before'`（`position < start`）：reset 续写时读**截断前**的 assistant，并入 UI 消息身份
   *   判定，使 reset 前后合并成一条、时长跨段连续。模型输入不变（压缩保留）。
   * - `'after'`（`position >= start`）：取**当前主链段**最后一条 assistant。递归子任务轮次用它作
   *   UI 流式消息的身份锚点（originalMessages 末尾是它），使渲染端把该轮输出**合并进这条消息**
   *   （复用 id），而不是新建一条带旧 parts 的副本。
   * 仅取一条，性能开销可忽略；均不影响模型输入（模型输入用 loadMessages）。
   */
  lastAssistant(id: string, side: 'before' | 'after'): UIMessage | undefined {
    // 两侧仅比较符与越界缺省不同：'before' 在 start 为 NULL 时应全量命中，缺省取 SQLite 最大
    // 整数；'after' 缺省取 -1 使全部 position 命中。大整数以 SQL 文本内联——作 JS 数字字面量
    // 会触发 no-loss-of-precision 告警（超过 Number.MAX_SAFE_INTEGER）。
    const sql =
      side === 'before'
        ? `SELECT messages.value FROM messages
             JOIN sessions ON sessions.id = messages.session_id
             WHERE messages.session_id = ?
               AND messages.position < COALESCE(sessions.start, 9223372036854775807)
               AND json_extract(messages.value, '$.role') = 'assistant'
               AND json_extract(messages.value, '$.metadata.nested') IS NOT 1
             ORDER BY messages.position DESC
             LIMIT 1`
        : `SELECT messages.value FROM messages
             JOIN sessions ON sessions.id = messages.session_id
             WHERE messages.session_id = ?
               AND messages.position >= COALESCE(sessions.start, -1)
               AND json_extract(messages.value, '$.role') = 'assistant'
               AND json_extract(messages.value, '$.metadata.nested') IS NOT 1
             ORDER BY messages.position DESC
             LIMIT 1`
    const row = this.database.prepare(sql).get(id)
    return row ? (JSON.parse(row.value as string) as UIMessage) : undefined
  }

  /**
   * 会话的最后一条消息（**不过滤 nested**）。用于判定「是否停在等待用户回答」：
   * `agent_ask_user` 可能出现在**子任务轮**（nested）里，而 lastAssistant 会过滤 nested，
   * 用它判定会漏掉子任务轮的 ask_user，导致 ask_user 后编排层不暂停、继续跑下一轮。
   */
  lastMessage(id: string): UIMessage | undefined {
    const row = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND messages.position >= COALESCE(sessions.start, -1)
         ORDER BY messages.position DESC
         LIMIT 1`
      )
      .get(id)
    return row ? (JSON.parse(row.value as string) as UIMessage) : undefined
  }

  /**
   * 按 `agent_ask_user` 的 `toolCallId` 定位承载它的那条消息（**不过滤 nested**）。
   *
   * 用途：ask_user 是客户端工具，用户回答经 `addToolOutput` 再次 `agent:send`；渲染层送来的
   * 消息**自带**被回答的 `toolCallId`。用它**精确**找到「谁在等这次回答」，从而拿到权威的
   * `metadata.nested` / `totalProcessingMs` / 落库身份——不必再用「最近一条消息 + position」
   * 去**倒推**（主链与嵌套链交错写入时，倒推会错位）。
   *
   * 范围含 nested，且**不受 `sessions.start` 游标影响**（等待态可能在游标之前）。
   */
  findMessageByAskUserCallId(id: string, toolCallId: string): UIMessage | undefined {
    const rows = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND json_extract(messages.value, '$.role') = 'assistant'
         ORDER BY messages.position DESC`
      )
      .all(id)
    for (const row of rows) {
      const message = JSON.parse(row.value as string) as UIMessage
      const matched = message.parts?.some((part) => {
        const tool = part as { type?: string; toolCallId?: string }
        return (
          (tool.type === 'tool-agent_ask_user' || tool.type === 'dynamic-tool') &&
          tool.toolCallId === toolCallId
        )
      })
      if (matched) return message
    }
    return undefined
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
        const metadata = message.metadata as Record<string, unknown> | undefined
        // 递归子任务消息不进导航（用户只按"自己的提问"导航）。
        if (metadata?.nested === true) continue
        if (message.role === 'user') {
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
