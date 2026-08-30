/* 造「单条巨型 assistant 消息」：N 个互不相同的 tool parts（各异 icon => 各自独立 tool-group）。
   目的：复现用户真实场景——异质工具流式时，activity-group 渲染 N 个独立 tool-group summary 行。
   用法: node tests/performance/seed-streaming-mega.mjs [N] [--remove] */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const sessionId = process.env.LARIFY_MEGA_SESSION_ID ?? 'perf-mega-session'
const toolCount = Number(process.env.LARIFY_MEGA_TOOL_COUNT ?? process.argv[2] ?? 374)
const databasePath =
  process.env.LARIFY_SESSION_DB ??
  join(process.env.APPDATA ?? join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'larify', 'sessions.db')

if (process.argv.includes('--remove')) {
  const db = new DatabaseSync(databasePath)
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  db.close()
  console.log(JSON.stringify({ removed: sessionId }))
  process.exit(0)
}

const now = Date.now()
const cwd = process.env.LARIFY_MEGA_CWD || 'D:/Workspace/larify-desktop'
const toolNames = ['fs_read', 'fs_grep', 'terminal_write', 'fs_edit', 'fs_glob', 'fs_write',
  'grep_context', 'read_file', 'list_dir', 'search_code', 'write_file', 'patch_file']
// 每个工具带不同 icon，保证各自独立成 tool-group（合并条件 toolIcon 相同时才合并）
const tools = Array.from({ length: toolCount }, (_, i) => ({
  type: 'dynamic-tool',
  toolName: toolNames[i % toolNames.length],
  toolCallId: `mega-tool-${i}`,
  state: 'output-available',
  toolMetadata: { icon: `t${i}` },
  input: { toolCallTitle: `工具调用 ${i}`, path: `fixtures/sample-${i}.ts` },
  output: { path: `fixtures/sample-${i}.ts`, content: `export const sample${i} = ${i}\n` }
}))

const messages = [
  {
    id: 'mega-user',
    role: 'user',
    parts: [{ type: 'text', text: `构造 ${toolCount} 个互不相同的工具调用以测量展开态渲染成本` }]
  },
  {
    id: 'mega-assistant',
    role: 'assistant',
    metadata: { startedAt: now - 10000, completedAt: now },
    parts: [
      { type: 'reasoning', text: '正在批量读取多个样本文件。', state: 'done' },
      ...tools,
      {
        type: 'text',
        text: `**完成。** 已执行 ${toolCount} 个工具调用，全部成功。`,
        state: 'done'
      }
    ]
  }
]

const db = new DatabaseSync(databasePath)
db.exec('PRAGMA busy_timeout = 10000;')
db.exec('BEGIN IMMEDIATE')
try {
  db.prepare(
    `INSERT INTO sessions (id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, cwd=excluded.cwd, start=NULL, updated_at=excluded.updated_at`
  ).run(sessionId, `[展开态基准] ${toolCount} 工具`, cwd, now, now)
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  const ins = db.prepare('INSERT INTO messages (session_id, id, value) VALUES (?, ?, ?)')
  for (const m of messages) ins.run(sessionId, m.id, JSON.stringify(m))
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}
const size = db.prepare(
  'SELECT LENGTH(value) AS bytes FROM messages WHERE session_id=?'
).all(sessionId).reduce((a, r) => a + r.bytes, 0)
const realRenderItems = db.prepare('SELECT value FROM messages WHERE session_id=? AND id=?')
  .get(sessionId, 'mega-assistant').value
const msg = JSON.parse(realRenderItems)
const distinctIcons = new Set(msg.parts.filter(p => p.type === 'dynamic-tool').map(p => p.toolMetadata?.icon)).size
const totalGroups = msg.parts.filter(p => p.type === 'dynamic-tool').length
db.close()
console.log(JSON.stringify({ sessionId, messages: messages.length, toolCount, bytes: size, distinctIcons, distinctGroups: totalGroups }))
