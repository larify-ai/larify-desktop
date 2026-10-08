import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'

// 复刻 `recentListItems` 的判据，喂真实 DB 数据，看看这个会话会渲染成什么。
// 注意：这里**无法** import 未导出的 recentListItems，故用 jsdom 渲染真实组件（见另一个探针）。
// 本探针只做「数据侧」判定：每轮的 sections / qualifiesForAggregation。

const SID = process.env.ZZ_SID || '648dcb99'

function loadMessages(): UIMessage[] {
  const p = (process.env.APPDATA || '') + '/larify/sessions.db'
  const db = new DatabaseSync(p, { readOnly: true })
  const sess = db.prepare('SELECT id, start FROM sessions WHERE id LIKE ?').get(SID + '%') as {
    id: string
    start: number | null
  }
  const rows = db
    .prepare(
      'SELECT position, value FROM messages WHERE session_id=? AND (COALESCE(?, -1) = -1 OR position <> ?) ORDER BY position'
    )
    .all(sess.id, sess.start, sess.start)
  return rows.map((r) => JSON.parse((r as { value: string }).value) as UIMessage)
}

function stageTitleOf(m: UIMessage): string[] {
  return (m.parts || [])
    .filter((p) => (p as { type?: string }).type === 'tool-agent_show_progress')
    .map((p) => (p as { input?: { title?: string } }).input?.title ?? '(no title)')
}

describe('数据侧：robot_lab模型 会话的每轮 show_progress 与 compaction', () => {
  it('打印每轮', () => {
    const messages = loadMessages()
    console.log('visible messages =', messages.length)
    for (const m of messages) {
      const titles = stageTitleOf(m)
      const compaction = (m.metadata as { compaction?: boolean } | undefined)?.compaction === true
      const textCount = (m.parts || []).filter((p) => p.type === 'text').length
      console.log(
        `${m.id.slice(0, 8)} ${m.role} parts=${(m.parts || []).length} text=${textCount} progress=${titles.length} ${JSON.stringify(titles)}${compaction ? ' [COMPACTION]' : ''}`
      )
    }
    expect(messages.length).toBeGreaterThan(0)
  })
})
