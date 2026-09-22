import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { withAnsweredTool } from '../../../../src/main/core/agent/persist'

type Parts = UIMessage['parts']
const text = (v: string): Parts[number] => ({ type: 'text', text: v })
const ask = (id: string, state: string, extra?: Record<string, unknown>): Parts[number] =>
  ({ type: 'tool-agent_ask_user', toolCallId: id, state, input: { q: 'q' }, ...extra }) as never
const msg = (id: string, parts: Parts): UIMessage => ({ id, role: 'assistant', parts }) as UIMessage

describe('withAnsweredTool 边界', () => {
  it('E1 正常：快照已终态 + 库内有该 toolCallId ⇒ 只覆盖那一个 part，其余与 id 不变', () => {
    const stored = msg('row-1', [text('a'), ask('c1', 'input-available'), text('b')])
    const snapshot = msg('main-anchor', [
      ask('c1', 'output-available', { output: { answers: ['ok'] } })
    ])
    const patched = withAnsweredTool(stored, snapshot, 'c1')!
    expect(patched.id).toBe('row-1')
    expect((patched.parts[0] as { text: string }).text).toBe('a')
    expect((patched.parts[2] as { text: string }).text).toBe('b')
    expect((patched.parts[1] as { state: string }).state).toBe('output-available')
    expect((patched.parts[1] as { output: unknown }).output).toEqual({ answers: ['ok'] })
  })

  it('E2 快照里仍是 input-available（未真答）⇒ 原样返回（不误覆盖）', () => {
    const stored = msg('row-1', [ask('c1', 'input-available')])
    const snapshot = msg('main-anchor', [ask('c1', 'input-available')])
    expect(withAnsweredTool(stored, snapshot, 'c1')).toBe(stored)
  })

  it('E3 快照里是 input-streaming ⇒ 原样返回', () => {
    const stored = msg('row-1', [ask('c1', 'input-available')])
    const snapshot = msg('main-anchor', [ask('c1', 'input-streaming')])
    expect(withAnsweredTool(stored, snapshot, 'c1')).toBe(stored)
  })

  it('E4 库内行不含该 toolCallId ⇒ 原样返回（不新增 part）', () => {
    const stored = msg('row-1', [text('a')])
    const snapshot = msg('main-anchor', [ask('c1', 'output-available')])
    const patched = withAnsweredTool(stored, snapshot, 'c1')!
    expect(patched).toBe(stored)
    expect(patched.parts.length).toBe(1)
  })

  it('E5 无 toolCallId / 无快照 / 无库内行 ⇒ 原样返回', () => {
    const stored = msg('row-1', [ask('c1', 'input-available')])
    expect(withAnsweredTool(stored, msg('m', [ask('c1', 'output-available')]), undefined)).toBe(
      stored
    )
    expect(withAnsweredTool(stored, undefined, 'c1')).toBe(stored)
    expect(
      withAnsweredTool(undefined, msg('m', [ask('c1', 'output-available')]), 'c1')
    ).toBeUndefined()
  })

  it('E6 快照里同名 toolCallId 出现两次（一次未答一次已答）⇒ find 取第一个命中终态的', () => {
    const stored = msg('row-1', [ask('c1', 'input-available')])
    const snapshot = msg('main-anchor', [
      ask('c1', 'input-available'),
      ask('c1', 'output-available', { output: { answers: ['y'] } })
    ])
    const patched = withAnsweredTool(stored, snapshot, 'c1')!
    expect((patched.parts[0] as { state: string }).state).toBe('output-available')
  })

  it('E7 不修改原对象（immutability）——stored 的 parts 不被就地改写', () => {
    const stored = msg('row-1', [ask('c1', 'input-available')])
    const before = JSON.stringify(stored)
    const snapshot = msg('m', [ask('c1', 'output-available', { output: { answers: ['z'] } })])
    withAnsweredTool(stored, snapshot, 'c1')
    expect(JSON.stringify(stored)).toBe(before)
  })
})
