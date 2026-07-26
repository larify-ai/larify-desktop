// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PerformanceMonitor } from '../../../../src/extensions/performance/renderer/performance-monitor'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('PerformanceMonitor', () => {
  afterEach(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('loads history and refreshes it for the selected range', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    const invoke = vi.fn(async () => ({ measures: [], samples: [] }))
    vi.stubGlobal('window', Object.assign(window, { bridge: { invoke } }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(PerformanceMonitor))
    })
    expect(invoke).toHaveBeenLastCalledWith('performance:history', expect.any(Number))

    const fiveMinutes = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '5 分钟'
    )
    expect(fiveMinutes).toBeDefined()
    await act(async () => {
      fiveMinutes!.click()
    })

    const since = invoke.mock.calls.at(-1)?.[1] as number
    expect(Date.now() - since).toBe(5 * 60_000)

    await act(async () => {
      root.unmount()
    })
  })
})
