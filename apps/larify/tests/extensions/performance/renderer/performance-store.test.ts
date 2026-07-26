import { afterEach, describe, expect, it, vi } from 'vitest'

describe('performance collector', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('starts once, records samples, and releases every observer when stopped', async () => {
    vi.useFakeTimers()
    const invoke = vi.fn(async () => {})
    const disconnect = vi.fn()
    const clearMeasures = vi.fn()
    const observers: Array<(list: { getEntries(): PerformanceEntry[] }) => void> = []
    class FakePerformanceObserver {
      constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) {
        observers.push(callback)
      }
      disconnect = disconnect
      observe = vi.fn()
    }
    const requestAnimationFrame = vi.fn(() => 7)
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('window', {
      bridge: { invoke },
      clearInterval,
      setInterval
    })
    vi.stubGlobal('document', {
      getElementsByTagName: () => ({ length: 42 })
    })
    vi.stubGlobal('performance', {
      clearMeasures,
      memory: { usedJSHeapSize: 1024 },
      now: () => 100,
      timeOrigin: 1000
    })
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    const { performanceCollector } =
      await import('../../../../src/extensions/performance/renderer/performance-store')
    performanceCollector.start()
    performanceCollector.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(
      'performance:record',
      expect.objectContaining({ domNodes: 42, heap: 1024 })
    )

    observers[0]({
      getEntries: () => [
        { duration: 12, name: 'larify:open-file', startTime: 3 } as PerformanceEntry
      ]
    })
    expect(invoke).toHaveBeenCalledWith('performance:measure', {
      duration: 12,
      name: 'open-file',
      timestamp: 1003
    })
    expect(clearMeasures).toHaveBeenCalledWith('larify:open-file')

    performanceCollector.stop()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
    expect(disconnect).toHaveBeenCalledOnce()

    const callsAfterStop = invoke.mock.calls.length
    observers[0]({
      getEntries: () => [
        { duration: 5, name: 'larify:directory-load', startTime: 4 } as PerformanceEntry
      ]
    })
    expect(invoke).toHaveBeenCalledTimes(callsAfterStop)
    expect(clearMeasures).toHaveBeenCalledWith('larify:directory-load')

    performanceCollector.dispose()
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
