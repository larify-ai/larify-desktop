import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  dispose: vi.fn(),
  initialize: vi.fn(),
  start: vi.fn()
}))

vi.mock('../../../../src/extensions/performance/renderer/performance-store', () => ({
  performanceCollector: h
}))

import extension from '../../../../src/extensions/performance/renderer'

describe('performance renderer extension', () => {
  it('does not start collection when the enabled check resolves after disposal', async () => {
    let resolveEnabled!: (value: boolean) => void
    const enabled = new Promise<boolean>((resolve) => {
      resolveEnabled = resolve
    })
    const stopListening = vi.fn()
    vi.stubGlobal('window', {
      bridge: {
        invoke: vi.fn(() => enabled),
        on: vi.fn(() => stopListening)
      }
    })
    const subscriptions: Array<{ dispose(): void }> = []

    extension.activate({} as never, { manifest: {}, subscriptions } as never)
    subscriptions[0].dispose()
    resolveEnabled(true)
    await enabled
    await Promise.resolve()

    expect(stopListening).toHaveBeenCalledOnce()
    expect(h.initialize).toHaveBeenCalledOnce()
    expect(h.dispose).toHaveBeenCalledOnce()
    expect(h.start).not.toHaveBeenCalled()
  })
})
