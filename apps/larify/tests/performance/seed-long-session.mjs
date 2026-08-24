/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const sessionId = process.env.LARIFY_LONG_SESSION_ID ?? 'perf-long-session-5200'
const messageCount = Number(process.env.LARIFY_LONG_SESSION_MESSAGES ?? 5200)
const databasePath =
  process.env.LARIFY_SESSION_DB ?? join(process.env.APPDATA, 'larify', 'sessions.db')
const cwd = process.env.LARIFY_LONG_SESSION_CWD ?? join(homedir(), '.larify', 'workspace')

if (!Number.isInteger(messageCount) || messageCount <= 5000) {
  throw new Error('LARIFY_LONG_SESSION_MESSAGES must be an integer greater than 5000.')
}

const markdownSection = (index) => `
## 性能测试章节 ${index}

这是用于长会话渲染测试的 Markdown。包含 **粗体**、*斜体*、[本地链接](README.md)、
行内代码 \`const value = ${index}\`，以及中英文混排内容。

| 指标 | 数值 | 说明 |
| --- | ---: | --- |
| message | ${index} | 超长会话 |
| tool | fs_read | 工具调用输出 |

\`\`\`ts
export function section${index}(value: number): number {
  return value * ${index + 1}
}
\`\`\`

> 长 Markdown 引用内容，用于测量解析、React mount、滚动和内存占用。

- 第一项：消息虚拟化
- 第二项：Markdown 渲染
- 第三项：工具调用折叠
`

const longMarkdown = Array.from({ length: 240 }, (_, index) => markdownSection(index)).join('\n')

const createMessage = (index) => {
  const id = `long-session-${String(index).padStart(5, '0')}`
  if (index % 2 === 0) {
    return {
      id,
      role: 'user',
      parts: [
        {
          type: 'text',
          text: `第 ${index + 1} 条用户消息：请继续分析长会话性能，并保持滚动位置稳定。`
        }
      ]
    }
  }

  const toolIndex = Math.floor(index / 2)
  const markdown =
    toolIndex % 200 === 0
      ? `# 超长 Markdown 压力样本 ${toolIndex}\n${longMarkdown}`
      : `### 分析结果 ${toolIndex}\n\n工具调用已完成。\n\n${markdownSection(toolIndex)}`
  return {
    id,
    role: 'assistant',
    metadata: { startedAt: index * 10, completedAt: index * 10 + 8 },
    parts: [
      {
        type: 'reasoning',
        text: `正在检查第 ${toolIndex} 个性能样本。`,
        state: 'done'
      },
      {
        type: 'dynamic-tool',
        toolName: 'fs_read',
        toolCallId: `long-session-tool-${toolIndex}`,
        state: 'output-available',
        input: {
          toolCallTitle: `读取性能样本 ${toolIndex}`,
          path: `fixtures/sample-${toolIndex}.ts`
        },
        output: {
          path: `fixtures/sample-${toolIndex}.ts`,
          content: `export const sample${toolIndex} = ${toolIndex}\n`.repeat(8)
        }
      },
      { type: 'text', text: markdown, state: 'done' }
    ]
  }
}

mkdirSync(dirname(databasePath), { recursive: true })
const database = new DatabaseSync(databasePath)
database.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;')

if (process.argv.includes('--remove')) {
  database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  database.close()
  console.log(JSON.stringify({ databasePath, removed: sessionId }, null, 2))
  process.exit(0)
}

const now = Date.now()
const insertMessage = database.prepare(
  'INSERT INTO messages (session_id, id, value) VALUES (?, ?, ?)'
)

database.exec('BEGIN IMMEDIATE')
try {
  database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  database
    .prepare(
      `INSERT INTO sessions (id, title, cwd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(sessionId, `[性能测试] ${messageCount} 条长会话`, cwd, now, now)
  for (let index = 0; index < messageCount; index += 1) {
    const message = createMessage(index)
    insertMessage.run(sessionId, message.id, JSON.stringify(message))
  }
  database.exec('COMMIT')
} catch (error) {
  database.exec('ROLLBACK')
  throw error
}

const result = database
  .prepare(
    `SELECT sessions.id, sessions.title, sessions.cwd, COUNT(messages.position) AS messages,
            SUM(LENGTH(messages.value)) AS jsonBytes
     FROM sessions JOIN messages ON messages.session_id = sessions.id
     WHERE sessions.id = ? GROUP BY sessions.id`
  )
  .get(sessionId)
database.close()

console.log(JSON.stringify({ databasePath, ...result }, null, 2))
