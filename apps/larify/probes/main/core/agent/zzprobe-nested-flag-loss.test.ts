import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../../../../src/main/core/agent/messages', () => ({
  prepareMessages: (messages: UIMessage[]) => messages
}))
vi.mock('../../../../src/main/core/agent/session', () => ({
  runAgentSession: mocks.run
}))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

const directories: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})
async function store(): Promise<SessionStore> {
  const dir = await mkdtemp(join(tmpdir(), 'probe-nested-flag-'))
  directories.push(dir)
  const s = new SessionStore(join(dir, 'sessions.db'))
  s.createSession({ cwd: '/workspace', id: 'session', title: 'S' })
  return s
}

describe('复现：#6843 那条「带 -nested- 前缀却丢了 nested 标记」的巨行', () => {
  it('嵌套轮内 ask_user 续写 → 承载行丢 nested → 泄漏进主链 + 下一轮 id 双层累积', async () => {
    const s = await store()
    const main: UIMessage = { id: 'main', role: 'assistant', parts: [{ type: 'text', text: 'main' }] }
    s.saveMessages('session', [main])

    // 第一轮嵌套：AI SDK 返回合并消息（id 复用主链锚点 → 落库成 main-nested-A）
    // 这一轮末尾停在 ask_user（input-available）→ 得到一个嵌套承载行
    mocks.run.mockImplementationOnce(async () => [
      { id: 'main', role: 'assistant', parts: [{ type: 'text', text: 'main' }, { type: 'text', text: 'n1' }, { type: 'tool-agent_ask_user', toolCallId: 'a1', state: 'input-available', input: {} } as never] } as UIMessage
    ])
    await runStoredAgentSession(s, {
      sessionId: 'session', cwd: '/workspace',
      message: { id: 'nest1', role: 'user', metadata: { nested: true, compaction: true }, parts: [{ type: 'text', text: 'task1' }] },
      nested: true, options: {} as never
    })
    const afterNest1 = s.loadVisibleMessages('session')
    console.log('\n嵌套轮1后：')
    afterNest1.forEach(r => console.log(`  ${r.id} nest=${(r.metadata as any)?.nested} N=${r.parts.length}`))

    // 第二轮：用户回答 a1 → 渲染层发来「主链 assistant 快照」（含已答 a1）
    const answer: UIMessage = {
      ...main,
      parts: [...main.parts, { type: 'tool-agent_ask_user', toolCallId: 'a1', state: 'output-available', input: {}, output: { answers: ['x'] } } as never]
    }
    // AI SDK 返回「锚点基线 + 增量」的整条（锚点 = main-nested-A）
    const anchor = s.loadVisibleMessages('session').find(r => (r.metadata as any)?.nested === true)!
    mocks.run.mockImplementationOnce(async () => [
      { ...anchor, parts: [...anchor.parts, { type: 'step-start' }, { type: 'text', text: 'after answer' }] } as UIMessage
    ])
    await runStoredAgentSession(s, {
      sessionId: 'session', cwd: '/workspace',
      message: answer, nested: true, previousStored: anchor, options: {} as never
    })
    const afterCont = s.loadVisibleMessages('session')
    console.log('\n续写后：')
    afterCont.forEach(r => console.log(`  ${r.id} nest=${(r.metadata as any)?.nested} N=${r.parts.length}`))

    // 断言：承载行应仍是 nested（否则泄漏进主链）
    const carrier = afterCont.find(r => r.id.startsWith('main-nested-'))!
    console.log('承载行 nested =', (carrier.metadata as any)?.nested)
    console.log('主链 loadMessages =', s.loadMessages('session').map(r => r.id))

    // 第三轮嵌套：看 id 是否双层累积
    const visible = s.lastVisibleAssistant('session')!
    mocks.run.mockImplementationOnce(async () => [
      { ...visible, parts: [...visible.parts, { type: 'text', text: 'n3' }] } as UIMessage
    ])
    await runStoredAgentSession(s, {
      sessionId: 'session', cwd: '/workspace',
      message: { id: 'nest3', role: 'user', metadata: { nested: true, compaction: true }, parts: [{ type: 'text', text: 'task3' }] },
      nested: true, options: {} as never
    })
    const round3 = s.loadVisibleMessages('session').find(r => r.role === 'assistant' && (r.metadata as any)?.nested === true && r.id !== carrier.id)
    console.log('\n第三轮嵌套行 id =', round3?.id, '（-nested- 出现', round3 ? round3.id.split('-nested-').length - 1 : 0, '次）')
    console.log('泄漏进主链的行 =', s.loadMessages('session').filter(r => r.id.includes('-nested-')).map(r => r.id))
    s.dispose()
    expect(true).toBe(true)
  })
})
