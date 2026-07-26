import type { PerformanceMeasureRecord, RendererPerformance } from '../shared/types'

let started = false
let stopCollection: (() => void) | undefined
let measureObserver: PerformanceObserver | undefined

const invoke = (channel: string, value: unknown): void => {
  void window.bridge.invoke(channel, value).catch(() => {})
}

const initializeMeasureObserver = (): void => {
  if (measureObserver) return
  measureObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.name.startsWith('larify:')) continue
      if (started) {
        const measure: PerformanceMeasureRecord = {
          duration: entry.duration,
          name: entry.name.replace('larify:', ''),
          timestamp: performance.timeOrigin + entry.startTime
        }
        invoke('performance:measure', measure)
      }
      performance.clearMeasures(entry.name)
    }
  })
  measureObserver.observe({ type: 'measure', buffered: true })
}

const rendererHeap = (): number => {
  const value = performance as Performance & { memory?: { usedJSHeapSize: number } }
  return value.memory?.usedJSHeapSize ?? 0
}

export const performanceCollector = {
  initialize: initializeMeasureObserver,
  start(): void {
    if (started) return
    initializeMeasureObserver()
    started = true
    let frames = 0
    let longestTask = 0
    let frameId = 0
    const countFrame = (): void => {
      frames += 1
      frameId = requestAnimationFrame(countFrame)
    }
    frameId = requestAnimationFrame(countFrame)

    const observers: PerformanceObserver[] = []
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longestTask = Math.max(longestTask, entry.duration)
      })
      observer.observe({ entryTypes: ['longtask'] })
      observers.push(observer)
    } catch {
      // Long Task API is unavailable in some renderer configurations.
    }
    let expected = performance.now() + 1000
    const interval = window.setInterval(() => {
      const now = performance.now()
      const elapsed = now - (expected - 1000)
      const sample: RendererPerformance = {
        domNodes: document.getElementsByTagName('*').length,
        eventLoopLag: Math.max(0, now - expected),
        fps: elapsed > 0 ? (frames * 1000) / elapsed : 0,
        heap: rendererHeap(),
        longestTask,
        timestamp: Date.now()
      }
      expected = now + 1000
      frames = 0
      longestTask = 0
      invoke('performance:record', sample)
    }, 1000)
    stopCollection = () => {
      cancelAnimationFrame(frameId)
      window.clearInterval(interval)
      for (const observer of observers) observer.disconnect()
      stopCollection = undefined
      started = false
    }
  },
  stop(): void {
    stopCollection?.()
  },
  dispose(): void {
    this.stop()
    measureObserver?.disconnect()
    measureObserver = undefined
  }
}
