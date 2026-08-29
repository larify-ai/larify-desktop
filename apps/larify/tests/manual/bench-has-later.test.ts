// 复现 hasLaterUserMessage 的 O(n^2)，并对比 O(n) 后缀数组方案
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'

const isCompactionMessage = (m: UIMessage): boolean =>
  m.role === 'user' &&
  typeof m.metadata === 'object' &&
  m.metadata !== null &&
  (m.metadata as Record<string, unknown>).compaction === true

const text = (s: string): UIMessage['parts'][number] => ({ type: 'text', text: s })

// ---- 当前实现：O(n^2)，每次 slice 产生临时数组 ----
const hasLaterUserMessageCurrent = (messages: UIMessage[], index: number): boolean =>
  messages.slice(index + 1).some((c) => c.role === 'user' && !isCompactionMessage(c))

// ---- 候选实现：反向遍历一次预计算，O(n)，无临时数组 ----
function laterUserFlags(messages: UIMessage[]): boolean[] {
  const flags = new Array<boolean>(messages.length)
  let seen = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    flags[index] = seen
    const message = messages[index]
    if (message.role === 'user' && !isCompactionMessage(message)) seen = true
  }
  return flags
}

function buildSession(rounds: number): UIMessage[] {
  const list: UIMessage[] = []
  for (let i = 0; i < rounds; i += 1) {
    list.push({ id: `u-${i}`, role: 'user', parts: [text('帮我看一下这个问题')] })
    list.push({ id: `a-${i}`, role: 'assistant', parts: [text('好的，我来处理')] })
  }
  return list
}

// 最坏情况：尾部追加大量 assistant（流式中的长轮次），some() 需扫到末尾
function buildWorst(rounds: number): UIMessage[] {
  const list = buildSession(rounds)
  for (let i = 0; i < rounds; i += 1) {
    list.push({ id: `tail-a-${i}`, role: 'assistant', parts: [text('x')] })
  }
  return list
}

function timeIt(label: string, iterations: number, fn: () => void): number {
  for (let i = 0; i < 2; i += 1) fn()
  const started = process.hrtime.bigint()
  for (let i = 0; i < iterations; i += 1) fn()
  const per = Number(process.hrtime.bigint() - started) / 1e6 / iterations
  console.log(`  ${label.padEnd(40)} ${per.toFixed(3)}ms`)
  return per
}

describe('hasLaterUserMessage 复现与修复对比', () => {
  it('典型会话：O(n^2) vs O(n)', { timeout: 120_000 }, () => {
    console.log('\n=== 典型会话（user/assistant 交替）===')
    for (const rounds of [500, 1000, 2600]) {
      const messages = buildSession(rounds)
      console.log(`\n--- messages=${messages.length} ---`)
      const before = timeIt('当前 O(n^2)', 5, () => {
        void messages.map((m, index) =>
          m.role === 'assistant' && hasLaterUserMessageCurrent(messages, index)
        )
      })
      const after = timeIt('候选 O(n) 后缀数组', 5, () => {
        const flags = laterUserFlags(messages)
        void messages.map((m, index) => m.role === 'assistant' && flags[index])
      })
      console.log(`     → 提升 ${(before / Math.max(after, 0.001)).toFixed(1)}×`)
    }
  })

  it('最坏情况：尾部大量 assistant', { timeout: 120_000 }, () => {
    console.log('\n=== 最坏情况（尾部追加 assistant，some 扫到末尾）===')
    for (const rounds of [1000, 2600]) {
      const messages = buildWorst(rounds)
      console.log(`\n--- messages=${messages.length} ---`)
      const before = timeIt('当前 O(n^2)', 3, () => {
        void messages.map((m, index) =>
          m.role === 'assistant' && hasLaterUserMessageCurrent(messages, index)
        )
      })
      const after = timeIt('候选 O(n) 后缀数组', 3, () => {
        const flags = laterUserFlags(messages)
        void messages.map((m, index) => m.role === 'assistant' && flags[index])
      })
      console.log(`     → 提升 ${(before / Math.max(after, 0.001)).toFixed(1)}×`)
    }
  })

  it('正确性：两种实现结果必须一致', () => {
    const cases = [
      buildSession(50),
      buildWorst(50),
      [],
      [{ id: 'u', role: 'user' as const, parts: [text('hi')] }],
      [{ id: 'a', role: 'assistant' as const, parts: [text('hi')] }]
    ]
    for (const messages of cases) {
      const flags = laterUserFlags(messages)
      for (let index = 0; index < messages.length; index += 1) {
        expect(flags[index]).toBe(hasLaterUserMessageCurrent(messages, index))
      }
    }
    // 显式验证语义：index 之后（不含自身）是否存在 user 消息
    const m: UIMessage[] = [
      { id: 'a0', role: 'assistant', parts: [text('x')] },
      { id: 'u0', role: 'user', parts: [text('q')] },
      { id: 'a1', role: 'assistant', parts: [text('y')] }
    ]
    expect(laterUserFlags(m)).toEqual([true, false, false])
  })
})
