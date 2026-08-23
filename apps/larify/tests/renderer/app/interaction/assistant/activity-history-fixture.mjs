import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const activityHistorySessionId = `larify-activity-history-cdp-${process.pid}`
export const activityHistorySessionTitle = 'CDP Reset 阶段分组（自动清理）'

const databasePath =
  process.env.LARIFY_ACTIVITY_HISTORY_SESSION_DB ??
  join(process.env.APPDATA, 'larify', 'sessions.db')

const progressPart = (id, title) => ({
  type: 'dynamic-tool',
  toolName: 'agent_show_progress',
  toolCallId: `progress-${id}`,
  state: 'output-available',
  input: { toolCallTitle: `开始${title}`, title },
  output: 'Progress shown.'
})

const resetPart = (id) => ({
  type: 'dynamic-tool',
  toolName: 'agent_reset_context',
  toolCallId: `reset-${id}`,
  state: 'output-available',
  input: {
    toolCallTitle: '切换上下文',
    handoff: `Continue after ${id}.`
  },
  output: 'Context reset requested.'
})

const activityPart = (id, title) => ({
  type: 'dynamic-tool',
  toolName: 'fs_read',
  toolCallId: `activity-${id}`,
  state: 'output-available',
  input: { toolCallTitle: title, path: `${id}.ts` },
  output: { path: `${id}.ts`, content: id }
})

const snapshotPart = (additions) => ({
  type: 'data-git-snapshot',
  data: {
    files: [
      {
        path: 'activity-history.ts',
        additions,
        deletions: 0,
        patch: '@@ -0,0 +1 @@\n+activity history'
      }
    ]
  }
})

const compactionMessage = (id) => ({
  id: `activity-history-compaction-${id}`,
  role: 'user',
  metadata: { compaction: true },
  parts: [{ type: 'text', text: `# Handoff\n\nContinue ${id}.` }]
})

const activityMessages = [
  {
    id: 'activity-history-stage-one',
    role: 'assistant',
    metadata: { startedAt: 1, completedAt: 2 },
    parts: [
      progressPart('research', '调研现有实现'),
      { type: 'reasoning', text: '调研现有实现', state: 'done' },
      activityPart('research', '读取现有实现'),
      snapshotPart(1),
      resetPart('research')
    ]
  },
  compactionMessage('implementation'),
  {
    id: 'activity-history-stage-two',
    role: 'assistant',
    metadata: { startedAt: 3, completedAt: 4 },
    parts: [
      progressPart('implementation', '实现并验证功能'),
      { type: 'reasoning', text: '实现并验证功能', state: 'done' },
      activityPart('implementation', '修改功能实现'),
      snapshotPart(2),
      resetPart('implementation')
    ]
  },
  compactionMessage('review'),
  {
    id: 'activity-history-stage-three',
    role: 'assistant',
    metadata: { startedAt: 5, completedAt: 6 },
    parts: [
      progressPart('review', '执行最终检查'),
      { type: 'reasoning', text: '执行最终检查', state: 'done' },
      activityPart('review', '检查最终结果'),
      snapshotPart(3),
      { type: 'text', text: 'ACTIVITY_HISTORY_CDP_COMPLETE', state: 'done' }
    ]
  }
]

const messages = [
  ...activityMessages,
  ...Array.from({ length: 48 }, (_, index) => ({
    id: `activity-history-filler-${index}`,
    role: 'user',
    parts: [{ type: 'text', text: `CDP 分页填充 ${index}` }]
  }))
]

function openDatabase() {
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA busy_timeout = 10000;
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
  `)
  return database
}

export function createActivityHistorySession() {
  const database = openDatabase()
  try {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(activityHistorySessionId)
    const now = Date.now()
    database
      .prepare(
        `INSERT INTO sessions (id, title, cwd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        activityHistorySessionId,
        activityHistorySessionTitle,
        join(homedir(), '.larify', 'workspace'),
        now,
        now
      )
    const insert = database.prepare('INSERT INTO messages (session_id, id, value) VALUES (?, ?, ?)')
    for (const message of messages) {
      insert.run(activityHistorySessionId, message.id, JSON.stringify(message))
    }
  } finally {
    database.close()
  }
}

export function removeActivityHistorySession() {
  const database = openDatabase()
  try {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(activityHistorySessionId)
  } finally {
    database.close()
  }
}
