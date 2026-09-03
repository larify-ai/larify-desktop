// @vitest-environment jsdom
//
// 复现测试：sessions.tsx 导航重构后的边界。
// 刻意断言「当前设计的行为」，用于：①证明边界真实存在（测试 PASS 于未修复代码）；
// ②作为将来修复的翻转基准（修复后 REPRO-1 应翻转断言）。
// 运行：npm test -- tests/renderer/app/interaction/assistant/sessions-nav-repro.test.ts

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantSessionsProvider } from '../../../../../src/renderer/src/app/interaction/assistant/sessions'
import {
  useAssistantSessions,
  type AssistantSessions
} from '../../../../../src/renderer/src/app/interaction/assistant/sessions-context'
import { useSessionAttentionReport } from '../../../../../src/renderer/src/app/interaction/assistant/session-attention'

let root: Root
let sessions: AssistantSessions
const invoke = vi.fn()

function Probe(): null {
  const value = useAssistantSessions()
  // 仅用于捕获最新 context 值
  useSessionAttentionReport()
  useEffect(() => {
    sessions = value
  }, [value])
  return null
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  invoke.mockReset()
  invoke.mockResolvedValue([])
  // 保存原 bridge，afterEach 还原，避免污染同一次运行里的其它测试文件（如 message-list 依赖自己的 bridge）。
  ;(globalThis as { __reproSavedBridge?: unknown }).__reproSavedBridge = (window as { bridge?: unknown }).bridge
  Object.defineProperty(window, 'bridge', {
    configurable: true,
    value: { invoke }
  })
  root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
  })
})

afterEach(() => {
  act(() => root.unmount())
  const saved = (globalThis as { __reproSavedBridge?: unknown }).__reproSavedBridge
  delete (globalThis as { __reproSavedBridge?: unknown }).__reproSavedBridge
  // window.bridge 可能是只读属性，用 defineProperty 还原（与设置时一致）。
  Object.defineProperty(window, 'bridge', { configurable: true, value: saved })
})

// 让目录返回给定的一组已持久化会话（updated_at DESC：数组首=最新）。
function mockDirectory(ids: string[]): void {
  invoke.mockImplementation((channel: string) => {
    if (channel === 'session:cwds') return Promise.resolve([''])
    if (channel === 'session:list') {
      return Promise.resolve(ids.map((id) => ({ id, title: id, cwd: '' })))
    }
    if (channel === 'session:msg-count') return Promise.resolve(1)
    if (channel === 'session:msgs') return Promise.resolve([])
    return Promise.resolve([])
  })
}

describe('sessions navigation edge cases (regression)', () => {
  // 边界 1（BUG 演示，非回归守卫）：index = -1 窗口。
  // 已持久化的 active 会话不在目录里（模拟 setPersisted 之后、refresh 重填目录之前的瞬间），
  // 此时 navigation.index = -1。当前设计未防护负索引：
  //   canBack = (index < len-1) = (-1 < 2) = true  → 误判"可后退"
  //   back()  → ordered[index+1] = ordered[0] = 'A' → 跳到错误的会话
  // 此用例刻意断言「当前有问题的行为」，用于证明边界确实存在（测试应 PASS 于未修复代码）。
  // 修复后对应断言应翻转：canBack=false、back() 停留在 first。
  it('REPRO index=-1: persisted active absent from directory makes back() jump to wrong session', async () => {
    act(() => root.unmount())
    mockDirectory(['A', 'B', 'C'])
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })

    const first = sessions.activeId // 初始 draft
    // 模拟瞬时窗口：draft 被标记 persisted，但目录（mock）尚未包含它。
    await act(async () => sessions.setPersisted(first))

    // navigation：active.persisted=true → ordered=directoryIds=['A','B','C']；
    // active(first) 不在目录 → index = -1。当前设计未防护。
    // eslint-disable-next-line no-console
    console.log('[REPRO-1] activeId=', sessions.activeId, 'canBack=', sessions.canBack, 'canForward=', sessions.canForward, 'activeInDirectory=', ['A', 'B', 'C'].includes(sessions.activeId))

    // 当前（有问题的）行为：canBack 误判为 true。
    expect(sessions.canBack).toBe(true)
    expect(sessions.canForward).toBe(false)

    // back() → ordered[-1+1] = ordered[0] = 'A'，跳到错误会话而非停留在 first。
    await act(async () => sessions.back())
    // eslint-disable-next-line no-console
    console.log('[REPRO-1] after back(), activeId=', sessions.activeId)
    expect(sessions.activeId).toBe('A')
  })

  // 行为说明（非 bug）：离开 draft 后用 forward/back 无法找回 draft。
  // 选中某已持久化会话后，ordered=directoryIds（不含 draft），draft 只能从侧边栏 select 回来。
  // 这是"按 updated_at 有序遍历"设计的固有行为（参照 zcode taskNav），与原 visit-history 栈不同。
  it('documented: draft unreachable via back/forward once a persisted session is active', async () => {
    act(() => root.unmount())
    mockDirectory(['A', 'B', 'C'])
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })

    const draftId = sessions.activeId // 初始 draft
    // 从 draft 后退到 A（draft 视为最新置首，back 落到目录首 = A）。
    await act(async () => sessions.back())
    expect(sessions.activeId).toBe('A')

    // 现在 active=A（已持久化）。尝试 forward 回 draft —— 应当无效（draft 不在 ordered 里）。
    // eslint-disable-next-line no-console
    console.log('[REPRO-2] after back to A: canForward=', sessions.canForward, 'canBack=', sessions.canBack)
    expect(sessions.canForward).toBe(false) // draft 不在 ordered 里，无法前进回去

    await act(async () => sessions.forward())
    // eslint-disable-next-line no-console
    console.log('[REPRO-2] after forward(), activeId=', sessions.activeId)
    expect(sessions.activeId).toBe('A') // 仍停在 A，draft 不可达

    // 对照：侧边栏 select(draftId) 仍能找回（证明只是前进/后退序列不含 draft）。
    await act(async () => sessions.select(draftId))
    expect(sessions.activeId).toBe(draftId)
  })

  // 边界 3（对照）：目录为空时 index=-1 同样安全（canBack/canForward 都为 false）。
  it('control: empty directory keeps nav disabled even with index=-1', async () => {
    act(() => root.unmount())
    mockDirectory([]) // 空目录
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })
    await act(async () => sessions.setPersisted(sessions.activeId))
    // eslint-disable-next-line no-console
    console.log('[REPRO-3] empty dir + persisted active: canBack=', sessions.canBack, 'canForward=', sessions.canForward)
    expect(sessions.canBack).toBe(false)
    expect(sessions.canForward).toBe(false)
  })
})
