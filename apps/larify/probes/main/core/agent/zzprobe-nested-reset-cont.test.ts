import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../../../src/main/core/agent/messages', () => ({ prepareMessages: (m: UIMessage[]) => m }))
vi.mock('../../../../src/main/core/agent/session', () => ({ runAgentSession: mocks.run }))
import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

const dirs: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true }))) })
async function mk(): Promise<SessionStore> {
  const d = await mkdtemp(join(tmpdir(), 'probe-nr-')); dirs.push(d)
  const s = new SessionStore(join(d, 'sessions.db')); s.createSession({ cwd: '/w', id: 'session', title: 'S' }); return s
}

describe('探路：非 nested 轮产出带 -nested- id 的行（nested 标记会丢）', () => {
  it('当 continuationAnchor 非 nested 但 response.id 带 -nested- → 原样落库、丢 nested', async () => {
    const s = await mk()
    const main: UIMessage = { id: 'main', role: 'assistant', parts: [{ type: 'text', text: 'm' }] }
    s.saveMessages('session', [main])

    // 已存在一条「带 -nested- id 但无 nested 标记」的畸形行（模拟 #6843 丢标记后的状态）
    const malformed: UIMessage = { id: 'main-nested-2f8ce25c', role: 'assistant', metadata: { totalProcessingMs: 1 }, parts: [{ type: 'text', text: 'old' }] }
    s.saveMessages('session', [malformed])

    // 现在模拟「新一轮嵌套」：idAnchor = lastAssistant('after') = malformed（因它无 nested 标记）
    mocks.run.mockImplementationOnce(async () => [
      { ...malformed, parts: [...malformed.parts, { type: 'text', text: 'new' }] } as UIMessage
    ])
    await runStoredAgentSession(s, {
      sessionId: 'session', cwd: '/w',
      message: { id: 'nest', role: 'user', metadata: { nested: true, compaction: true }, parts: [{ type: 'text', text: 'task' }] },
      nested: true, options: {} as never
    })
    const rows = s.loadVisibleMessages('session')
    console.log('\n结果：')
    rows.forEach(r => console.log(`  ${r.id} nest=${(r.metadata as any)?.nested} N=${r.parts.length}`))
    const newRow = rows.find(r => r.id !== 'main' && r.id !== 'main-nested-2f8ce25c' && !r.id.startsWith('nest'))
    console.log('新嵌套行 id =', newRow?.id, '；-nested- 次数 =', newRow ? newRow.id.split('-nested-').length - 1 : 0)
    console.log('主链 =', s.loadMessages('session').map(r => r.id))
    s.dispose()
    expect(true).toBe(true)
  })
})
