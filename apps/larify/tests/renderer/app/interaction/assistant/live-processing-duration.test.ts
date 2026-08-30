// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveProcessingDuration } from '../../../../../src/renderer/src/app/interaction/assistant/live-processing-duration'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(active: boolean, startedAt: number): Promise<void> {
  await act(async () =>
    root.render(createElement(LiveProcessingDuration, { startedAt, active }))
  )
}

describe('live processing duration', () => {
  it('reports the elapsed time from absolute timestamps', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(6_000)
    try {
      await render(true, 1_000)
      expect(container.textContent).toBe('处理了 5秒')

      await act(async () => vi.advanceTimersByTime(1_000))
      expect(container.textContent).toBe('处理了 6秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses the interval while the conversation is hidden', async () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    try {
      vi.setSystemTime(6_000)
      await render(true, 1_000)
      expect(container.textContent).toBe('处理了 5秒')
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)

      // 隐藏会话：计时器必须被清理，不再产生每秒重渲染。
      await render(false, 1_000)
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

      vi.setSystemTime(20_000)
      await act(async () => vi.advanceTimersByTime(1_000))
      expect(container.textContent).toBe('处理了 5秒')
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)

      // 恢复活跃：立即校准到真实时长（不丢秒），并重启计时器。
      await render(true, 1_000)
      expect(container.textContent).toBe('处理了 20秒')
      expect(setIntervalSpy).toHaveBeenCalledTimes(2)
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    } finally {
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
