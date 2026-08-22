import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export const stressSessionId = 'larify-performance-long-history-v1'
export const stressSessionTitle = 'PERF 超长对话 2000 条（自动清理）'

const databasePath =
  process.env.LARIFY_PERF_SESSION_DB ?? join(process.env.APPDATA, 'larify', 'sessions.db')

export function removeStressSession() {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON')
    database.prepare('DELETE FROM sessions WHERE id = ?').run(stressSessionId)
  } finally {
    database.close()
  }
}

export function createStressSession({ cwd, messageCount = 2_000 }) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON')
    database.prepare('DELETE FROM sessions WHERE id = ?').run(stressSessionId)
    const now = Date.now()
    database
      .prepare(
        `INSERT INTO sessions (id, title, cwd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(stressSessionId, stressSessionTitle, cwd, now, now)
    const insert = database.prepare('INSERT INTO messages (session_id, id, value) VALUES (?, ?, ?)')
    database.exec('BEGIN IMMEDIATE')
    try {
      for (let index = 0; index < messageCount; index += 1) {
        const role = index % 2 === 0 ? 'user' : 'assistant'
        const text =
          role === 'user'
            ? `性能测试消息 ${index}：请分析这一段较长的对话内容。`.repeat(6)
            : `性能测试回复 ${index}\n\n${'- 列表内容与 **Markdown** 文本。\n'.repeat(12)}`
        insert.run(
          stressSessionId,
          `larify-perf-${index}`,
          JSON.stringify({ id: `larify-perf-${index}`, role, parts: [{ type: 'text', text }] })
        )
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    database.close()
  }
}
