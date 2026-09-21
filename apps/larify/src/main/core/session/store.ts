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
   * 会话里**最后一条可见 assistant**（**不过滤 nested**，`position >= start`）。
   *
   * 用于递归子任务轮次的 **UI 流式消息身份锚点**：渲染层把嵌套行也当普通 assistant 消息持有
   * （nested 只影响模型输入与导航，不影响 live messages），故「渲染层此刻的末端 assistant」
   * 就是这里的返回值。锚点必须与它**逐字相同**，AI SDK 才会走 `replaceMessage`（原地替换）；
   * 否则客户端 `replaceLastMessage=false` → `pushMessage`（新建，并把锚点全部 parts 复制为基线）
   * → **UI 整段内容重复**（实测：第二个及以后的嵌套轮）。
   *
   * 与 `lastAssistant(id,'after')` 的区别：后者带 `nested IS NOT 1` 过滤 ⇒ 恒返回主链行，
   * 在「上一轮是嵌套轮」时与渲染层末端不一致 ⇒ 触发上述重复。
   */
  lastVisibleAssistant(id: string): UIMessage | undefined {
    const row = this.database
      .prepare(
        `SELECT messages.value FROM messages
         JOIN sessions ON sessions.id = messages.session_id
         WHERE messages.session_id = ?
           AND messages.position >= COALESCE(sessions.start, -1)
           AND json_extract(messages.value, '$.role') = 'assistant'
         ORDER BY messages.position DESC
         LIMIT 1`
      )
      .get(id)
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
   * 定位「正在等待该 `ask_user` 回答」的上下文：返回承载行 `owner`，并在它是**嵌套行**时
   * **顺带取回本轮的 nest 判据**（`owner` 的前一条 user 行；实测 nested 行与其判据 100% 紧邻）。
   *
   * 用途：用户回答经 `addToolOutput` → 新 `send()` 送达。此时应让模型**从该子任务轮继续**——
   * 即输入 = `[nest 判据, 回答]`（而非现状的「只有回答」，也非「越权读整条主链」）。
   * 判据定位靠「紧邻」这一实测事实；取不到就返回 `prompt: undefined`（调用方退回现状，行为不变）。
   */
  findAskUserContext(
    id: string,
    toolCallId: string
  ): { owner: UIMessage; prompt?: UIMessage } | undefined {
    // 一条自连接 SQL：同时取「承载行 owner」与其「前一条 prev」，避免两次查询。
    const row = this.database
      .prepare(
        `SELECT m.value AS owner, prev.value AS prev
         FROM messages m
         JOIN json_each(m.value, '$.parts') p
         LEFT JOIN messages prev
           ON prev.session_id = m.session_id
          AND prev.position = (SELECT MAX(p2.position) FROM messages p2
                               WHERE p2.session_id = m.session_id AND p2.position < m.position)
         WHERE m.session_id = ?
           AND json_extract(m.value, '$.role') = 'assistant'
           AND json_extract(p.value, '$.type') IN ('tool-agent_ask_user', 'dynamic-tool')
           AND json_extract(p.value, '$.toolCallId') = ?
           AND json_extract(p.value, '$.state') = 'input-available'
         ORDER BY m.position DESC
         LIMIT 1`
      )
      .get(id, toolCallId) as { owner: string; prev: string | null } | undefined
    if (!row) return undefined
    const owner = JSON.parse(row.owner) as UIMessage
    // 仅当 owner 是**嵌套行**时，其前一条才是本轮的 nest 判据（实测 100% 紧邻）。
    if ((owner.metadata as Record<string, unknown> | undefined)?.nested !== true || !row.prev) {
      return { owner }
    }
    const candidate = JSON.parse(row.prev) as UIMessage
    const meta = candidate.metadata as Record<string, unknown> | undefined
    // 判据签名：user + nested + compaction（与编排层构造一致）；不匹配则视为无判据（兜底）。
    const isNestPrompt =
      candidate.role === 'user' && meta?.nested === true && meta?.compaction === true
    return isNestPrompt ? { owner, prompt: candidate } : { owner }
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
