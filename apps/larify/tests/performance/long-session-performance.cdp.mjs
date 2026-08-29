/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { connectLarifyCdp } from '../manual/cdp-client.mjs'

const sessionId = process.env.LARIFY_LONG_SESSION_ID ?? 'perf-long-session-5200'
const expectedMessageCount = Number(process.env.LARIFY_LONG_SESSION_MESSAGES ?? 5200)
const latestAssistantIndex = Math.floor(expectedMessageCount / 2) - 1
const scrollOnly = process.env.LARIFY_PERF_SCROLL_ONLY === '1'
const layoutOnly = process.env.LARIFY_PERF_LAYOUT_ONLY === '1'
const navigationOnly = process.env.LARIFY_PERF_NAVIGATION_ONLY === '1'
const traceEnabled = process.env.LARIFY_PERF_TRACE === '1'
const wheelDelta = Number(process.env.LARIFY_PERF_WHEEL_DELTA ?? 120)
const wheelIntervalMs = Number(process.env.LARIFY_PERF_WHEEL_INTERVAL_MS ?? 30)
const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const workspacePreviewFiles = [
  {
    before: { expected: 'larify', path: join(appRoot, 'package.json') },
    target: { expected: 'defineConfig', path: join(appRoot, 'electron.vite.config.ts') }
  },
  {
    before: { expected: 'new-york', path: join(appRoot, 'components.json') },
    target: { expected: 'larify', path: join(appRoot, 'package.json') }
  }
]
const stopAfterPhase = Number(process.env.LARIFY_PERF_STOP_AFTER ?? Number.POSITIVE_INFINITY)
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const withTimeout = (promise, label, timeout = 5_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

const waitFor = async (expression, label, timeout = 30_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const startProbe = () =>
  evaluate(`(() => {
    window.__larifyLongSessionProbe?.observer?.disconnect()
    const probe = { frames: [], last: performance.now(), longTasks: [], running: true }
    const frame = (now) => {
      probe.frames.push(now - probe.last)
      probe.last = now
      if (probe.running) requestAnimationFrame(frame)
    }
    probe.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push(entry.duration)
    })
    probe.observer.observe({ type: 'longtask' })
    window.__larifyLongSessionProbe = probe
    requestAnimationFrame(frame)
  })()`)

const stopProbe = () =>
  evaluate(`(() => {
    const probe = window.__larifyLongSessionProbe
    probe.running = false
    probe.observer.disconnect()
    const sorted = probe.frames.toSorted((left, right) => left - right)
    const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
    return {
      frames: sorted.length,
      averageMs: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: Math.max(0, ...sorted),
      framesOver50: sorted.filter((value) => value > 50).length,
      longTasks: probe.longTasks.length,
      maxLongTaskMs: Math.max(0, ...probe.longTasks)
    }
  })()`)

const rendererMetrics = async () => {
  const metrics = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]))
}

try {
  const performanceRegressions = []
  console.error('perf-stage: reload')
  await cdp.send('Page.enable')
  await cdp.send('Performance.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await cdp.send('Page.bringToFront')
  await waitFor(
    `(async () => (await window.bridge.invoke('session:msg-count', ${JSON.stringify(sessionId)})) === ${expectedMessageCount})()`,
    `${expectedMessageCount} persisted messages`
  )
  console.error('perf-stage: session-count-ready')
  await waitFor(
    `(() => {
      const button = document.querySelector(${JSON.stringify(`button[data-session-id="${sessionId}"]`)})
      if (button) {
        button.click()
        return true
      }
      for (const candidate of document.querySelectorAll('button')) {
        if (candidate.textContent?.trim() === '更多') candidate.click()
      }
      return false
    })()`,
    'long session button'
  )
  console.error('perf-stage: session-open')
  if (navigationOnly) {
    await waitFor(
      `Boolean(document.querySelector('[data-message-scroll-viewport]') && document.querySelector('[aria-label="对话快速导航"]'))`,
      'message viewport and navigation rail'
    )
    await wait(500)
    await startProbe()
    await evaluate(`(() => {
      const probe = window.__larifyNavigationBlankFrames = { count: 0, running: true }
      const sample = () => {
        if (document.querySelectorAll('[data-message-index]').length === 0) probe.count += 1
        if (probe.running) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })()`)

    const railState = () =>
      evaluate(`(() => {
        const rail = document.querySelector('[aria-label="对话快速导航"]')
        return {
          count: rail?.querySelectorAll('[data-navigation-entry]').length ?? 0,
          firstId: rail?.querySelector('[data-navigation-entry]')?.dataset.navigationEntry,
          scrollTop: rail?.scrollTop ?? 0,
          scrollHeight: rail?.scrollHeight ?? 0,
          clientHeight: rail?.clientHeight ?? 0
        }
      })()`)
    const visibleMarker = () =>
      evaluate(`(() => {
        const rail = document.querySelector('[aria-label="对话快速导航"]')
        const railBounds = rail.getBoundingClientRect()
        const marker = [...rail.querySelectorAll('[data-navigation-entry]')]
          .filter((candidate) => {
            const bounds = candidate.getBoundingClientRect()
            const center = bounds.top + bounds.height / 2
            return center >= railBounds.top && center <= railBounds.bottom &&
              candidate.getAttribute('aria-current') !== 'true'
          })
          .sort((left, right) => {
            const center = railBounds.top + railBounds.height * 0.75
            const leftBounds = left.getBoundingClientRect()
            const rightBounds = right.getBoundingClientRect()
            return Math.abs(leftBounds.top + leftBounds.height / 2 - center) -
              Math.abs(rightBounds.top + rightBounds.height / 2 - center)
          })[0]
        if (!marker) return null
        const bounds = marker.getBoundingClientRect()
        return {
          id: marker.dataset.navigationEntry,
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2
        }
      })()`)
    const clickMarker = async (marker, timeout = 5_000) => {
      assert.ok(marker, 'a visible navigation marker should exist')
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: marker.x,
          y: marker.y,
          button: 'none',
          buttons: 0
        })
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: marker.x,
          y: marker.y,
          button: 'left',
          buttons: 1,
          clickCount: 1
        })
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: marker.x,
          y: marker.y,
          button: 'left',
          buttons: 0,
          clickCount: 1
        })
        try {
          await waitFor(
            `document.querySelector('[aria-label="对话快速导航"] [aria-current="true"]')?.dataset.navigationEntry === ${JSON.stringify(marker.id)}`,
            `navigation marker ${marker.id} to become active`,
            timeout / 3
          )
          return
        } catch (error) {
          if (attempt === 2) throw error
        }
      }
    }
    const dragRail = async (fromFraction, toFraction) => {
      await waitFor(
        `document.querySelector('[aria-label="对话快速导航"]') !== null`,
        'navigation rail to be available before dragging',
        5_000
      )
      const bounds = await evaluate(`(() => {
        const bounds = document.querySelector('[aria-label="对话快速导航"]').getBoundingClientRect()
        return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
      })()`)
      const x = bounds.left + bounds.width / 2
      const y = (fraction) => bounds.top + 6 + (bounds.height - 12) * fraction
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y: y(fromFraction),
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      for (let step = 1; step <= 24; step += 1) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y: y(fromFraction + (toFraction - fromFraction) * (step / 24)),
          button: 'left',
          buttons: 1
        })
        await wait(16)
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y: y(toFraction),
        button: 'left',
        buttons: 0,
        clickCount: 1
      })
      await wait(250)
    }

    const initial = await railState()
    let firstMarker = await visibleMarker()
    let hoverReady = false
    for (let attempt = 0; attempt < 3 && !hoverReady; attempt += 1) {
      firstMarker = (await visibleMarker()) ?? firstMarker
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: firstMarker.x - 100,
        y: firstMarker.y,
        button: 'none',
        buttons: 0
      })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: firstMarker.x,
        y: firstMarker.y,
        button: 'none',
        buttons: 0
      })
      await wait(250)
      hoverReady = await evaluate(
        `document.querySelector('[data-navigation-preview]')?.dataset.navigationPreview === ${JSON.stringify(firstMarker.id)}`
      )
    }
    if (!hoverReady) {
      await evaluate(`(() => {
        const marker = document.querySelector('[data-navigation-entry="${firstMarker.id}"]')
        if (!marker) return
        marker.dispatchEvent(new PointerEvent('pointerover', {
          bubbles: true,
          clientX: ${firstMarker.x},
          clientY: ${firstMarker.y}
        }))
        marker.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          clientX: ${firstMarker.x},
          clientY: ${firstMarker.y}
        }))
      })()`)
      await wait(200)
      hoverReady = await evaluate(
        `document.querySelector('[data-navigation-preview]')?.dataset.navigationPreview === ${JSON.stringify(firstMarker.id)}`
      )
    }
    const visual = await evaluate(`(() => {
      const rail = document.querySelector('[aria-label="对话快速导航"]')
      const parent = rail.parentElement
      const railBounds = rail.getBoundingClientRect()
      const parentBounds = parent.getBoundingClientRect()
      const visible = [...rail.querySelectorAll('[data-navigation-entry]')].filter((marker) => {
        const bounds = marker.getBoundingClientRect()
        const center = bounds.top + bounds.height / 2
        return center >= railBounds.top && center <= railBounds.bottom
      })
      const markers = [...rail.querySelectorAll('[data-navigation-entry]')]
      const focusedIndex = markers.findIndex(
        (marker) => marker.dataset.navigationEntry === ${JSON.stringify(firstMarker.id)}
      )
      const markerWidth = (offset) =>
        Number.parseFloat(markers[focusedIndex + offset]?.firstElementChild?.style.width ?? '')
      const previewText = document.querySelector('[data-navigation-preview]')?.textContent ?? ''
      return {
        centerDifference:
          railBounds.top + railBounds.height / 2 - (parentBounds.top + parentBounds.height / 2),
        rightGap: parentBounds.right - railBounds.right,
        visibleMarkers: visible.length,
        focusedWidth: markerWidth(0),
        previousWidth: markerWidth(-1),
        nextWidth: markerWidth(1),
        previewLength: previewText.trim().length
      }
    })()`)
    assert.ok(
      Math.abs(visual.centerDifference) <= 1,
      'navigation rail should be vertically centered'
    )
    assert.ok(Math.abs(visual.rightGap - 12) <= 1, 'navigation rail should keep a 12px right gap')
    assert.ok(visual.visibleMarkers <= 50, 'navigation rail should show no more than 50 markers')
    if (hoverReady) {
      assert.ok(Math.abs(visual.focusedWidth - 26) <= 0.1, 'hovered marker should expand to 26px')
      assert.ok(
        Math.abs(visual.previousWidth - 20) <= 0.1 || Math.abs(visual.nextWidth - 20) <= 0.1,
        'a marker next to the hovered marker should expand to 20px'
      )
      assert.ok(visual.previewLength > 0, 'hover preview should include message text')
    }
    console.error('perf-stage: navigation-visual-ready')
    const initiallyBookmarked = await evaluate(
      `document.querySelector('[data-navigation-entry="${firstMarker.id}"]')?.dataset.navigationBookmarked === 'true'`
    )

    const toggleBookmark = () =>
      evaluate(`document.querySelector('[data-navigation-entry="${firstMarker.id}"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
    await toggleBookmark()
    await waitFor(
      `document.querySelector('[data-navigation-entry="${firstMarker.id}"]')?.dataset.navigationBookmarked === ${JSON.stringify(initiallyBookmarked ? undefined : 'true')}`,
      'navigation bookmark to toggle'
    )
    await toggleBookmark()
    await waitFor(
      `document.querySelector('[data-navigation-entry="${firstMarker.id}"]')?.dataset.navigationBookmarked === ${JSON.stringify(initiallyBookmarked ? 'true' : undefined)}`,
      'navigation bookmark to restore'
    )
    console.error('perf-stage: navigation-bookmark-ready')
    await clickMarker(firstMarker)
    console.error('perf-stage: navigation-click-ready')
    await wait(800)
    await dragRail(0.25, 0.75)
    console.error('perf-stage: navigation-drag-down-ready')
    await dragRail(0.75, 0)
    console.error('perf-stage: navigation-drag-up-ready')
    const dragUpState = await evaluate(`(() => {
        const rail = document.querySelector('[aria-label="对话快速导航"]')
        return {
          activeId: rail.querySelector('[aria-current="true"]')?.dataset.navigationEntry,
          firstId: rail.querySelector('[data-navigation-entry]')?.dataset.navigationEntry,
          count: rail.querySelectorAll('[data-navigation-entry]').length
        }
      })()`)
    await wait(1_000)
    const settledDragId = await evaluate(
      `document.querySelector('[aria-label="对话快速导航"] [aria-current="true"]')?.dataset.navigationEntry`
    )
    assert.equal(settledDragId, dragUpState.activeId, 'top drag navigation should remain selected')

    const beforeBoundary = initial
    const boundary = await waitFor(
      `(() => {
        const rail = document.querySelector('[aria-label="对话快速导航"]')
        const count = rail?.querySelectorAll('[data-navigation-entry]').length ?? 0
        const firstId = rail?.querySelector('[data-navigation-entry]')?.dataset.navigationEntry
        return count > ${beforeBoundary.count} || firstId !== ${JSON.stringify(beforeBoundary.firstId)}
          ? { count, firstId }
          : null
      })()`,
      'next navigation cache boundary',
      5_000
    )
    console.error('perf-stage: navigation-boundary-ready')
    await evaluate(`(() => {
      const rail = document.querySelector('[aria-label="对话快速导航"]')
      rail.scrollTop = 0
    })()`)
    await wait(50)
    const boundaryMarker = await evaluate(`(() => {
      const rail = document.querySelector('[aria-label="对话快速导航"]')
      const marker = rail.querySelector('[data-navigation-entry]')
      if (!marker) return null
      const bounds = marker.getBoundingClientRect()
      return {
        id: marker.dataset.navigationEntry,
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
      }
    })()`)
    await clickMarker(boundaryMarker, 15_000)

    const performance = await stopProbe()
    const result = await evaluate(`(() => {
      const probe = window.__larifyNavigationBlankFrames
      probe.running = false
      const rail = document.querySelector('[aria-label="对话快速导航"]')
      return {
        activeId: rail.querySelector('[aria-current="true"]')?.dataset.navigationEntry,
        blankFrames: probe.count,
        markerCount: rail.querySelectorAll('[data-navigation-entry]').length,
        renderedMessages: document.querySelectorAll('[data-message-index]').length,
        domNodes: document.querySelectorAll('*').length
      }
    })()`)
    assert.equal(
      result.activeId,
      boundaryMarker.id,
      'boundary marker click should select its message'
    )
    assert.equal(result.blankFrames, 0, 'navigation should keep message content mounted')
    console.log(
      JSON.stringify(
        {
          sessionId,
          expectedMessageCount,
          initial,
          firstClick: { targetId: firstMarker.id },
          visual,
          drags: ['down', 'up'],
          beforeBoundary,
          boundary,
          boundaryClick: { targetId: boundaryMarker.id, activeId: result.activeId },
          performance,
          state: result
        },
        null,
        2
      )
    )
    cdp.close()
    process.exit(0)
  }
  if (scrollOnly || layoutOnly) {
    await waitFor(
      `Boolean(document.querySelector('[data-message-scroll-viewport]') && document.querySelector('[aria-label="对话快速导航"]'))`,
      'message viewport and navigation rail'
    )
    await wait(500)
    const horizontalAlignment = await evaluate(`(() => {
      const message = [...document.querySelectorAll('[data-message-layout-shell]')]
        .find((element) => element.getClientRects().length > 0)
      const composer = [...document.querySelectorAll('[data-composer-layout-shell]')]
        .find((element) => element.getClientRects().length > 0)
      if (!message || !composer) return null
      const messageBounds = message.getBoundingClientRect()
      const composerBounds = composer.getBoundingClientRect()
      return {
        leftDifference: messageBounds.left - composerBounds.left,
        rightDifference: messageBounds.right - composerBounds.right
      }
    })()`)
    assert.ok(horizontalAlignment, 'message and composer layout shells should exist')
    assert.ok(
      Math.abs(horizontalAlignment.leftDifference) <= 1 &&
        Math.abs(horizontalAlignment.rightDifference) <= 1,
      `message history and composer must align: ${JSON.stringify(horizontalAlignment)}`
    )
    if (layoutOnly) {
      console.log(JSON.stringify({ sessionId, expectedMessageCount, horizontalAlignment }, null, 2))
      cdp.close()
      process.exit(0)
    }
    console.error('perf-stage: scroll-probe')
    await evaluate(`(() => {
      const scroller = document.querySelector('[data-message-scroll-viewport]')
      scroller.scrollTop = scroller.scrollHeight
    })()`)
    await wait(300)
    const traceEvents = []
    let finishTrace
    const traceComplete = new Promise((resolve) => {
      finishTrace = resolve
    })
    const removeTraceListener = cdp.onEvent((message) => {
      if (message.method === 'Tracing.dataCollected') traceEvents.push(...message.params.value)
      if (message.method === 'Tracing.tracingComplete') finishTrace()
    })
    if (traceEnabled) {
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8',
        options: 'record-until-full',
        transferMode: 'ReportEvents'
      })
    }
    await startProbe()
    const wheelBounds = await evaluate(`(() => {
      const bounds = document.querySelector('[data-message-scroll-viewport]').getBoundingClientRect()
      window.__larifyWheelBlankFrames = 0
      const sample = () => {
        if (document.querySelectorAll('[data-message-index]').length === 0) {
          window.__larifyWheelBlankFrames += 1
        }
        window.__larifyWheelBlankFrame = requestAnimationFrame(sample)
      }
      sample()
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    })()`)
    const wheelToBoundary = async (target) => {
      const started = Date.now()
      let events = 0
      let stableBoundaryChecks = 0
      while (events < 10_000) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: wheelBounds.x,
          y: wheelBounds.y,
          deltaX: 0,
          deltaY: target === 'top' ? -wheelDelta : wheelDelta
        })
        events += 1
        await wait(wheelIntervalMs)
        if (events % 10 !== 0) continue
        const state = await evaluate(`(() => {
          const scroller = document.querySelector('[data-message-scroll-viewport]')
          return {
            distanceTop: scroller.scrollTop,
            distanceBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
            scrollTop: scroller.scrollTop
          }
        })()`)
        const distance = target === 'top' ? state.distanceTop : state.distanceBottom
        if (distance <= 1) {
          stableBoundaryChecks += 1
          if (stableBoundaryChecks >= 3) {
            await wait(250)
            return { durationMs: Date.now() - started, events, scrollTop: state.scrollTop }
          }
          await wait(120)
        } else {
          stableBoundaryChecks = 0
        }
      }
      const scrollTop = await evaluate(
        `document.querySelector('[data-message-scroll-viewport]').scrollTop`
      )
      return { durationMs: Date.now() - started, events, scrollTop }
    }
    const toTop = await wheelToBoundary('top')
    console.error('perf-stage: wheel-top-complete')
    const toBottom = await wheelToBoundary('bottom')
    const blankFrames = await evaluate(`(() => {
      cancelAnimationFrame(window.__larifyWheelBlankFrame)
      return window.__larifyWheelBlankFrames
    })()`)
    const scroll = { blankFrames, toTop, toBottom, wheelDelta, wheelIntervalMs }
    const scrollPerformance = await stopProbe()
    if (traceEnabled) {
      await cdp.send('Tracing.end')
      await Promise.race([traceComplete, wait(5_000)])
    }
    removeTraceListener()
    const traceSummary = traceEnabled
      ? (() => {
          const totals = new Map()
          const longEvents = []
          for (const event of traceEvents) {
            if (event.ph !== 'X' || typeof event.dur !== 'number') continue
            const durationMs = event.dur / 1_000
            totals.set(event.name, (totals.get(event.name) ?? 0) + durationMs)
            if (durationMs >= 50) longEvents.push({ name: event.name, durationMs })
          }
          return {
            events: traceEvents.length,
            topTotals: [...totals.entries()]
              .map(([name, durationMs]) => ({ name, durationMs }))
              .sort((left, right) => right.durationMs - left.durationMs)
              .slice(0, 20),
            longest: longEvents
              .sort((left, right) => right.durationMs - left.durationMs)
              .slice(0, 20)
          }
        })()
      : null
    console.error('perf-stage: click-probe')
    await startProbe()
    const clickStarted = await evaluate(`performance.now()`)
    await evaluate(`(() => {
      const first = document.querySelector('[aria-label="对话快速导航"] button')
      first?.click()
      return Boolean(first)
    })()`)
    await wait(1_000)
    const clickPerformance = await stopProbe()
    const clickDurationMs = (await evaluate(`performance.now()`)) - clickStarted
    await startProbe()
    const railBounds = await evaluate(`(() => {
      const bounds = document.querySelector('[aria-label="对话快速导航"]').getBoundingClientRect()
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
    })()`)
    const dragX = railBounds.left + 2
    const dragStartY = railBounds.top + 9.5
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: dragX,
      y: dragStartY,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    for (let step = 0; step <= 60; step += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: dragX,
        y: railBounds.top + 9.5 + (railBounds.height - 19) * (step / 60),
        button: 'left',
        buttons: 1
      })
      await wait(16)
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: dragX,
      y: railBounds.top + railBounds.height - 9.5,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
    await wait(300)
    const dragPerformance = await stopProbe()
    const heap = await cdp.send('Runtime.getHeapUsage')
    console.error('perf-stage: collect-state')
    const state = await evaluate(`(() => {
      const scroller = document.querySelector('[data-message-scroll-viewport]')
      const rail = document.querySelector('[aria-label="对话快速导航"]')
      return {
        domNodes: document.querySelectorAll('*').length,
        renderedMessages: document.querySelectorAll('[data-message-index]').length,
        markerCount: rail?.querySelectorAll('button').length ?? 0,
        railHeight: rail?.getBoundingClientRect().height ?? 0,
        railScrollHeight: rail?.scrollHeight ?? 0,
        scrollTop: scroller?.scrollTop ?? 0
      }
    })()`)
    console.log(
      JSON.stringify(
        {
          sessionId,
          expectedMessageCount,
          scroll,
          scrollPerformance,
          trace: traceSummary,
          click: { durationMs: clickDurationMs, performance: clickPerformance },
          drag: { steps: 60, performance: dragPerformance },
          heap: { usedMiB: heap.usedSize / 1024 / 1024, totalMiB: heap.totalSize / 1024 / 1024 },
          state
        },
        null,
        2
      )
    )
    cdp.close()
    process.exit(0)
  }
  const workbenchResources = await evaluate(`(async () => {
    window.dispatchEvent(new Event('larify:workbench-open'))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const resizeHandle = document.querySelector('.larify-workbench-resize-handle')
    const workbenchPane = document.querySelector('.larify-workbench-pane')
    if (resizeHandle && workbenchPane) {
      const targetWidth = Math.min(1_500, Math.max(700, innerWidth - 600))
      const currentWidth = workbenchPane.getBoundingClientRect().width
      const key = currentWidth < targetWidth ? 'ArrowLeft' : 'ArrowRight'
      const steps = Math.ceil(Math.abs(targetWidth - currentWidth) / 10)
      for (let index = 0; index < steps; index += 1) {
        resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
    const desired = { workspace: 2, changes: 2, terminal: 2, browser: 4 }
    const browserUrls = [
      'https://example.com/',
      'https://www.wikipedia.org/',
      'https://github.com/',
      'https://developer.mozilla.org/'
    ]
    const options = {
      workspace: { root: ${JSON.stringify(appRoot)} },
      changes: { root: ${JSON.stringify(appRoot)} },
      terminal: { cwd: ${JSON.stringify(appRoot)} },
      browser: {}
    }
    const existing = await window.bridge.invoke('resource:list', {
      sessionId: ${JSON.stringify(sessionId)}
    })
    const keep = []
    const remove = []
    for (const [rendererId, count] of Object.entries(desired)) {
      const matching = existing.filter(({ type }) => type === rendererId)
      keep.push(...matching.slice(0, count))
      remove.push(...matching.slice(count))
    }
    remove.push(...existing.filter(({ type }) => !(type in desired)))
    if (remove.length) {
      await window.bridge.invoke('resource:close-many', remove.map(({ id }) => id))
    }
    const created = []
    for (const [rendererId, count] of Object.entries(desired)) {
      const current = keep.filter(({ type }) => type === rendererId)
      for (let index = current.length; index < count; index += 1) {
        const resourceId = await window.bridge.invoke(
          'resource:create', rendererId, ${JSON.stringify(sessionId)}, options[rendererId]
        )
        const resource = {
          id: resourceId, type: rendererId, sessionId: ${JSON.stringify(sessionId)}
        }
        keep.push(resource)
        created.push(resource)
      }
    }
    for (const resource of keep) {
      window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
        detail: {
          rendererId: resource.type,
          resourceId: resource.id,
          sessionId: ${JSON.stringify(sessionId)}
        }
      }))
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const browsers = keep.filter(({ type }) => type === 'browser')
    for (let index = 0; index < browsers.length; index += 1) {
      await window.bridge.invoke(
        'browser:navigate', ${JSON.stringify(sessionId)}, browsers[index].id, browserUrls[index]
      )
    }
    const browserStates = []
    for (let attempt = 0; attempt < 150; attempt += 1) {
      browserStates.length = 0
      for (const browser of browsers) {
        browserStates.push(await window.bridge.invoke(
          'browser:getState', ${JSON.stringify(sessionId)}, browser.id
        ))
      }
      if (browserStates.every((state, index) =>
        state && !state.error && state.title &&
        state.url.startsWith(new URL(browserUrls[index]).origin)
      )) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const workspacePreviews = []
    const workspaces = keep.filter(({ type }) => type === 'workspace')
    const workspaceFiles = ${JSON.stringify(workspacePreviewFiles)}
    for (let index = 0; index < workspaces.length; index += 1) {
      const resource = workspaces[index]
      window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
        detail: {
          rendererId: resource.type,
          resourceId: resource.id,
          sessionId: ${JSON.stringify(sessionId)}
        }
      }))
      const clickFile = async (file) => {
        let clicked = false
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const active = document.querySelector(
            '[data-workbench-view="workspace"][data-resource-id="' + resource.id + '"]' +
            '[data-active="true"]'
          )
          const title = [...(active?.querySelectorAll('.workspace-tree [title]') ?? [])]
            .find((element) => element.getAttribute('title') === file.path)
          const node = title?.closest('.rc-tree-node-content-wrapper')
          if (node) {
            node.click()
            clicked = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        let ready = false
        for (let attempt = 0; attempt < 150; attempt += 1) {
          const view = document.querySelector(
            '[data-workbench-view="workspace"][data-resource-id="' + resource.id + '"]'
          )
          if (
            view?.querySelector('.workspace-file-preview .monaco-editor') &&
            view.querySelector('.view-lines')?.textContent?.includes(file.expected)
          ) {
            ready = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return { clicked, ready }
      }
      const before = await clickFile(workspaceFiles[index].before)
      const target = await clickFile(workspaceFiles[index].target)
      const view = document.querySelector(
        '[data-workbench-view="workspace"][data-resource-id="' + resource.id + '"]'
      )
      const editor = view?.querySelector('.workspace-file-preview .monaco-editor')
      const bounds = editor?.getBoundingClientRect()
      const tokenColors = new Set(
        [...(editor?.querySelectorAll('.view-line span') ?? [])]
          .map((element) => getComputedStyle(element).color)
          .filter(Boolean)
      )
      workspacePreviews.push({
        before,
        bounds: bounds && { height: bounds.height, width: bounds.width },
        file: workspaceFiles[index].target.path,
        lineCount: editor?.querySelectorAll('.view-line').length ?? 0,
        resourceId: resource.id,
        selected: view?.querySelector('.rc-tree-node-selected [title]')?.getAttribute('title'),
        target,
        tokenColors: tokenColors.size,
        previewClass: view?.querySelector('.workspace-file-preview')?.className ?? null,
        text: view?.textContent?.trim().slice(0, 120) ?? null
      })
    }
    const resources = await window.bridge.invoke('resource:list', {
      sessionId: ${JSON.stringify(sessionId)}
    })
    const file = keep.find(({ type }) => type === 'workspace')
    window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
      detail: {
        rendererId: file.type,
        resourceId: file.id,
        sessionId: ${JSON.stringify(sessionId)}
      }
    }))
    return { browserStates, created, removed: remove.length, resources, workspacePreviews }
  })()`)
  assert.equal(
    workbenchResources.resources.length,
    10,
    'the long session must keep exactly 10 tabs'
  )
  assert.equal(
    workbenchResources.browserStates.filter(
      (state) => state && !state.error && state.title && /^https:/.test(state.url)
    ).length,
    4,
    'all four browser tabs must finish a real HTTPS navigation'
  )
  console.error(
    JSON.stringify({ workspacePreviews: workbenchResources.workspacePreviews }, null, 2)
  )
  assert.ok(
    workbenchResources.workspacePreviews.every(
      ({ before, bounds, file, lineCount, selected, target, tokenColors }) =>
        before.clicked &&
        before.ready &&
        target.clicked &&
        target.ready &&
        bounds?.height > 0 &&
        bounds?.width > 0 &&
        lineCount > 0 &&
        selected === file &&
        tokenColors >= 2
    ),
    'both file tabs must switch models and render visible, highlighted target content'
  )
  const changesTitles = await waitFor(
    `(() => {
      const views = [...document.querySelectorAll('[data-workbench-view="changes"]')]
      const titles = views.map((view) => document.querySelector(
        '[data-tab-id="' + view.dataset.viewId + '"] .larify-workbench-tab-title'
      )?.textContent?.trim() ?? '')
      return titles.length === 2 && titles.every((title) => title && title !== '变更')
        ? titles
        : null
    })()`,
    'inactive changes tabs preload their first file names'
  )
  assert.equal(changesTitles.length, 2, 'both changes tabs must display a file name before click')
  const changesPreviews = []
  for (const resource of workbenchResources.resources.filter(({ type }) => type === 'changes')) {
    await evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
      detail: {
        rendererId: 'changes',
        resourceId: ${resource.id},
        sessionId: ${JSON.stringify(sessionId)}
      }
    }))`)
    changesPreviews.push(
      await waitFor(
        `(() => {
          const view = document.querySelector(
            '[data-workbench-view="changes"][data-resource-id="${resource.id}"][data-active="true"]'
          )
          const preview = view?.querySelector('.workspace-file-preview')
          const bounds = preview?.getBoundingClientRect()
          const lines = preview?.querySelectorAll('.view-line').length ?? 0
          return bounds?.width > 0 && bounds?.height > 0 && lines > 0
            ? { height: bounds.height, lines, width: bounds.width }
            : null
        })()`,
        `changes ${resource.id} renders diff content on first activation`
      )
    )
  }
  assert.ok(
    changesPreviews.every(({ height, lines, width }) => height > 0 && lines > 0 && width > 0),
    'both changes tabs must render real diff content on first activation'
  )
  const idleFile = workbenchResources.resources.find(({ type }) => type === 'workspace')
  await evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
    detail: {
      rendererId: 'workspace',
      resourceId: ${idleFile.id},
      sessionId: ${JSON.stringify(sessionId)}
    }
  }))`)
  await waitFor(
    `document.querySelector('[data-workbench-view][data-active="true"]')?.dataset.workbenchView === 'workspace'`,
    'file tab selected for the idle probe'
  )
  const hiddenNonBrowserViews = await evaluate(`(() =>
    [...document.querySelectorAll('[data-workbench-view]:not([data-workbench-view="browser"])')]
      .filter((view) => view.querySelector(':scope > [style*="display: none"]')).length
  )()`)
  assert.equal(
    hiddenNonBrowserViews,
    0,
    'all local workbench instances must stay warm and pause through their active prop'
  )
  // Monaco reports its DOM before deferred tokenization and layout have settled.
  // Keep cold-file work out of the steady-state idle window; tab switching below
  // measures the user-visible activation path separately.
  await wait(2_000)
  const settlingWindows = []
  let quietWindows = 0
  for (let index = 0; index < 12 && quietWindows < 2; index += 1) {
    const before = await rendererMetrics()
    await startProbe()
    await wait(1_000)
    const window = await stopProbe()
    const after = await rendererMetrics()
    window.rendererTaskMs = (after.TaskDuration - before.TaskDuration) * 1_000
    settlingWindows.push(window)
    if (
      window.p95Ms < 25 &&
      window.maxMs < 50 &&
      window.longTasks === 0 &&
      window.rendererTaskMs < 80
    ) {
      quietWindows += 1
    } else {
      quietWindows = 0
    }
  }
  assert.equal(quietWindows, 2, 'renderer did not reach two quiet windows within 12 seconds')
  const idleBefore = await rendererMetrics()
  await startProbe()
  await wait(5_000)
  const idle = await stopProbe()
  const idleAfter = await rendererMetrics()
  idle.rendererTaskMs = (idleAfter.TaskDuration - idleBefore.TaskDuration) * 1_000
  idle.scriptMs = (idleAfter.ScriptDuration - idleBefore.ScriptDuration) * 1_000
  idle.layoutMs = (idleAfter.LayoutDuration - idleBefore.LayoutDuration) * 1_000
  idle.styleMs = (idleAfter.RecalcStyleDuration - idleBefore.RecalcStyleDuration) * 1_000
  console.error(JSON.stringify({ idle, settlingWindows }, null, 2))
  assert.ok(idle.p95Ms < 25, `idle p95 frame gap regressed to ${idle.p95Ms.toFixed(1)}ms`)
  assert.ok(idle.maxMs < 50, `idle max frame gap regressed to ${idle.maxMs.toFixed(1)}ms`)
  assert.equal(idle.longTasks, 0, 'idle state must not generate long tasks')
  assert.ok(
    idle.rendererTaskMs < 300,
    `idle renderer task time regressed to ${idle.rendererTaskMs.toFixed(1)}ms over 5 seconds`
  )

  const terminalMarkers = await evaluate(`(() =>
    [...document.querySelectorAll('[data-workbench-view="terminal"] .larify-terminal-surface')]
      .map((surface, index) => {
        surface.dataset.performanceInstance = 'terminal-' + index
        return surface.dataset.performanceInstance
      })
  )()`)
  assert.equal(terminalMarkers.length, 2, 'both terminal instances must be initialized')
  const workspaceMarkers = await evaluate(`(() =>
    [...document.querySelectorAll('[data-workbench-view="workspace"]')].map((view, index) => {
      const preview = view.querySelector('.workspace-file-preview')
      preview.dataset.performanceInstance = 'workspace-' + index
      return {
        marker: preview.dataset.performanceInstance,
        path: view.textContent
      }
    })
  )()`)
  assert.equal(workspaceMarkers.length, 2, 'both workspace previews must be initialized')
  const workspaceScrollPositions = []
  for (const resource of workbenchResources.resources.filter(({ type }) => type === 'workspace')) {
    const editorCenter = await evaluate(`(async () => {
      window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
        detail: {
          rendererId: 'workspace',
          resourceId: ${resource.id},
          sessionId: ${JSON.stringify(sessionId)}
        }
      }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const editor = document.querySelector(
        '[data-workbench-view="workspace"][data-resource-id="${resource.id}"] .monaco-editor'
      )
      const bounds = editor?.getBoundingClientRect()
      return bounds && { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    })()`)
    assert.ok(editorCenter, 'the active file preview must have measurable editor bounds')
    for (let index = 0; index < 5; index += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: editorCenter.x,
        y: editorCenter.y,
        deltaX: 0,
        deltaY: 240
      })
    }
    await wait(200)
    workspaceScrollPositions.push(
      await evaluate(`document.querySelector(
        '[data-workbench-view="workspace"][data-resource-id="${resource.id}"]' +
        ' .scrollbar.vertical .slider'
      )?.style.top ?? ''`)
    )
  }
  assert.ok(
    workspaceScrollPositions.every((position) => position && position !== '0px'),
    'CDP wheel input must visibly scroll both real file previews'
  )
  await startProbe()
  const tabSwitches = []
  for (const resource of workbenchResources.resources) {
    const state = await withTimeout(
      evaluate(`new Promise((resolve, reject) => {
        const startedAt = performance.now()
        const read = () => {
          const active = document.querySelector('[data-workbench-view][data-active="true"]')
          if (active?.dataset.workbenchView !== ${JSON.stringify(resource.type)} ||
              Number(active?.dataset.resourceId) !== ${resource.id}) return null
          return {
            durationMs: performance.now() - startedAt,
            activeViews: document.querySelectorAll('[data-workbench-view][data-active="true"]').length,
            totalViews: document.querySelectorAll('[data-workbench-view]').length,
            pausedNonBrowserViews: [...document.querySelectorAll(
              '[data-workbench-view]:not([data-workbench-view="browser"]):not([data-active="true"])'
            )].filter((view) => view.querySelector(':scope > [style*="display: none"]')).length
          }
        }
        const observer = new MutationObserver(() => {
          const state = read()
          if (!state) return
          clearTimeout(timer)
          observer.disconnect()
          resolve(state)
        })
        const timer = setTimeout(() => {
          observer.disconnect()
          reject(new Error('active tab DOM did not update'))
        }, 2_000)
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-active'],
          subtree: true
        })
        window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
          detail: {
            rendererId: ${JSON.stringify(resource.type)},
            resourceId: ${resource.id},
            sessionId: ${JSON.stringify(sessionId)}
          }
        }))
        const immediate = read()
        if (immediate) {
          clearTimeout(timer)
          observer.disconnect()
          resolve(immediate)
        }
      })`),
      `select ${resource.type}:${resource.id}`,
      3_000
    )
    assert.equal(state.activeViews, 1, 'tab switching must leave exactly one active view')
    assert.equal(state.totalViews, 10, 'tab switching must preserve all 10 views')
    assert.equal(
      state.pausedNonBrowserViews,
      0,
      'local workbench instances must remain warm while switching'
    )
    tabSwitches.push({ rendererId: resource.type, resourceId: resource.id, ...state })
    await wait(100)
  }
  const tabSwitchPerformance = await stopProbe()
  await startProbe()
  const warmTabSwitches = []
  for (const resource of workbenchResources.resources) {
    const state = await withTimeout(
      evaluate(`new Promise((resolve, reject) => {
        const startedAt = performance.now()
        const finish = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
          durationMs: performance.now() - startedAt,
          activeViews: document.querySelectorAll('[data-workbench-view][data-active="true"]').length,
          totalViews: document.querySelectorAll('[data-workbench-view]').length
        })))
        const observer = new MutationObserver(() => {
          const active = document.querySelector('[data-workbench-view][data-active="true"]')
          if (active?.dataset.workbenchView !== ${JSON.stringify(resource.type)} ||
              Number(active?.dataset.resourceId) !== ${resource.id}) return
          clearTimeout(timer)
          observer.disconnect()
          finish()
        })
        const timer = setTimeout(() => {
          observer.disconnect()
          reject(new Error('warm tab DOM did not update'))
        }, 2_000)
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-active'], subtree: true })
        window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
          detail: { rendererId: ${JSON.stringify(resource.type)}, resourceId: ${resource.id}, sessionId: ${JSON.stringify(sessionId)} }
        }))
      })`),
      `warm select ${resource.type}:${resource.id}`,
      3_000
    )
    warmTabSwitches.push({ rendererId: resource.type, resourceId: resource.id, ...state })
    await wait(100)
  }
  const warmTabSwitchPerformance = await stopProbe()
  const terminalPersistence = await evaluate(`(() =>
    [...document.querySelectorAll('[data-workbench-view="terminal"] .larify-terminal-surface')]
      .map((surface) => ({
        marker: surface.dataset.performanceInstance,
        active: surface.dataset.terminalActive
      }))
  )()`)
  assert.deepEqual(
    terminalPersistence.map(({ marker }) => marker),
    terminalMarkers,
    'terminal DOM instances must survive inactive and active transitions'
  )
  assert.ok(
    terminalPersistence.every(({ active }) => active === 'false'),
    'inactive terminals must disable their active behavior'
  )
  const workspacePersistence = await evaluate(`(() =>
    [...document.querySelectorAll('[data-workbench-view="workspace"]')].map((view) => {
      const preview = view.querySelector('.workspace-file-preview')
      return {
        marker: preview?.dataset.performanceInstance,
        scrollPosition: preview?.querySelector('.scrollbar.vertical .slider')?.style.top ?? ''
      }
    })
  )()`)
  assert.deepEqual(
    workspacePersistence.map(({ marker }) => marker),
    workspaceMarkers.map(({ marker }) => marker),
    'file preview DOM instances must survive tab switches'
  )
  assert.ok(
    workspacePersistence.every(
      ({ scrollPosition }, index) =>
        Math.abs(
          Number.parseFloat(scrollPosition) - Number.parseFloat(workspaceScrollPositions[index])
        ) <= 8
    ),
    'file preview scroll positions must survive tab switches within layout rounding tolerance'
  )
  console.error(
    JSON.stringify(
      {
        coldActivations: tabSwitches,
        coldActivationPerformance: tabSwitchPerformance,
        warmTabSwitches,
        warmTabSwitchPerformance
      },
      null,
      2
    )
  )
  if (tabSwitches.some(({ durationMs }) => durationMs >= 250))
    performanceRegressions.push('a first tab activation took 250ms or longer')
  if (
    warmTabSwitches
      .filter(({ rendererId }) => rendererId === 'workspace')
      .some(({ durationMs }) => durationMs >= 70)
  )
    performanceRegressions.push('a warm real file tab switch took 70ms or longer')
  if (
    warmTabSwitches
      .filter(({ rendererId }) => rendererId !== 'workspace')
      .some(({ durationMs }) => durationMs >= 80)
  )
    performanceRegressions.push('a warm non-file tab switch took 80ms or longer')
  if (warmTabSwitchPerformance.p95Ms >= 80)
    performanceRegressions.push(
      `warm tab switching p95 frame gap regressed to ${warmTabSwitchPerformance.p95Ms.toFixed(1)}ms`
    )
  if (warmTabSwitchPerformance.maxLongTaskMs >= 80)
    performanceRegressions.push(
      `warm tab switching generated ${warmTabSwitchPerformance.longTasks} long tasks up to ${warmTabSwitchPerformance.maxLongTaskMs.toFixed(1)}ms`
    )

  if (stopAfterPhase <= 2) {
    const heap = await cdp.send('Runtime.getHeapUsage')
    console.log(
      JSON.stringify(
        {
          phases: {
            1: '10 mixed tabs idle',
            2: 'switch all 10 tabs and preserve paused state',
            3: `scroll ${expectedMessageCount}-message session to both ends`,
            4: 'drag interaction/workbench divider',
            5: 'collapse and expand workbench',
            6: 'collapse and expand navigation',
            7: 'rapidly switch tabs and settle on the final request',
            8: 'repeat tab switching and detect DOM or heap growth'
          },
          workbenchResources: workbenchResources.resources.map(({ id, type }) => ({ id, type })),
          idle,
          tabSwitches,
          tabSwitchPerformance,
          heap: {
            usedMiB: heap.usedSize / 1024 / 1024,
            totalMiB: heap.totalSize / 1024 / 1024
          }
        },
        null,
        2
      )
    )
    cdp.close()
    process.exit(0)
  }
  const openedAt = Date.now()
  await waitFor(
    `document.querySelector('[role="log"]')?.textContent?.includes(${JSON.stringify(`分析结果 ${latestAssistantIndex}`)})`,
    'latest message rendered'
  )
  const openMs = Date.now() - openedAt

  await startProbe()
  const topStarted = await evaluate(`performance.now()`)
  const topProgress = []
  for (let step = 0; step < 1_000; step += 1) {
    const before = await withTimeout(
      evaluate(`(() => {
        const scroller = document.querySelector('[data-message-scroll-viewport]')
        const visible = [...document.querySelectorAll('[data-message-index]')]
          .map((element) => Number(element.dataset.messageIndex))
        const state = {
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          firstIndex: Math.min(...visible),
          lastIndex: Math.max(...visible)
        }
        if (scroller.scrollTop > 0) {
          scroller.scrollTop = Math.max(0, scroller.scrollTop - scroller.clientHeight * 8)
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
        }
        return state
      })()`),
      `scroll-to-top step ${step}`
    )
    if (step % 10 === 0 || before.scrollTop === 0) topProgress.push({ step, ...before })
    if (step % 5 === 0) console.error(JSON.stringify({ scrollStep: step, ...before }))
    if (before.scrollTop === 0) break
    await wait(50)
  }
  await waitFor(
    `document.querySelector('[data-message-index="0"]')?.textContent?.includes('第 1 条用户消息')`,
    'first persisted message rendered'
  )
  const topMs = (await evaluate(`performance.now()`)) - topStarted
  await wait(300)
  const scrollToTop = await stopProbe()

  const scrollerCenter = await evaluate(`(() => {
    const rect = document.querySelector('[data-message-scroll-viewport]').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await startProbe()
  await cdp.send('Input.synthesizeScrollGesture', {
    x: scrollerCenter.x,
    y: scrollerCenter.y,
    yDistance: -10_000,
    speed: 5_000,
    gestureSourceType: 'mouse'
  })
  await cdp.send('Input.synthesizeScrollGesture', {
    x: scrollerCenter.x,
    y: scrollerCenter.y,
    yDistance: 10_000,
    speed: 5_000,
    gestureSourceType: 'mouse'
  })
  await wait(300)
  const bidirectionalScroll = await stopProbe()

  const handle = await evaluate(`(() => {
    const sash = [...document.querySelectorAll('.larify-allotment .sash-vertical')]
      .find((element) => element.getBoundingClientRect().height > 0)
    const rect = sash.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await startProbe()
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: handle.x,
    y: handle.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  for (let index = 0; index <= 60; index += 1) {
    const progress = index / 60
    const x = 180 + 340 * (progress <= 0.5 ? progress * 2 : (1 - progress) * 2)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y: handle.y,
      button: 'left',
      buttons: 1
    })
    await wait(16)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: handle.x,
    y: handle.y,
    button: 'left',
    buttons: 0
  })
  await wait(300)
  const horizontalResize = await stopProbe()

  const togglePanel = async (fromLabel, toLabel, collapsedExpression, expandedExpression) => {
    await startProbe()
    const before = await evaluate(`(() => ({
      resources: document.querySelectorAll('[data-workbench-view]').length,
      active: document.querySelectorAll('[data-workbench-view][data-active="true"]').length
    }))()`)
    assert.ok(
      await evaluate(
        `(() => { const button = document.querySelector('[aria-label="${fromLabel}"]'); button?.click(); return Boolean(button) })()`
      ),
      `${fromLabel} button must exist`
    )
    await waitFor(collapsedExpression, `${fromLabel} result`)
    assert.ok(
      await evaluate(
        `(() => { const button = document.querySelector('[aria-label="${toLabel}"]'); button?.click(); return Boolean(button) })()`
      ),
      `${toLabel} button must exist`
    )
    await waitFor(expandedExpression, `${toLabel} result`)
    await wait(200)
    const after = await evaluate(`(() => ({
      resources: document.querySelectorAll('[data-workbench-view]').length,
      active: document.querySelectorAll('[data-workbench-view][data-active="true"]').length
    }))()`)
    assert.deepEqual(after, before, `${fromLabel}/${toLabel} must preserve mounted resources`)
    const performance = await stopProbe()
    if (performance.maxLongTaskMs >= 100)
      performanceRegressions.push(
        `${fromLabel}/${toLabel} caused a ${performance.maxLongTaskMs}ms long task`
      )
    return { before, after, performance }
  }

  const workbenchCollapse = await togglePanel(
    '隐藏工作台',
    '显示工作台',
    `document.querySelector('.larify-workbench-pane')?.getAttribute('aria-hidden') === 'true' && document.querySelector('.larify-workbench-pane')?.getBoundingClientRect().width === 0`,
    `document.querySelector('.larify-workbench-pane')?.getAttribute('aria-hidden') === 'false' && document.querySelector('.larify-workbench-pane')?.getBoundingClientRect().width > 0`
  )
  const navigationCollapse = await togglePanel(
    '隐藏侧边栏',
    '显示侧边栏',
    `Boolean(document.querySelector('[aria-label="显示侧边栏"]'))`,
    `Boolean(document.querySelector('[aria-label="隐藏侧边栏"]'))`
  )

  let rapidTabSwitching = null
  let repeatedTabSwitching = null
  if (stopAfterPhase >= 7) {
    await startProbe()
    const rapidStartedAt = await evaluate(`performance.now()`)
    const rapidState = await evaluate(`(async () => {
      const resources = ${JSON.stringify(workbenchResources.resources)}
      for (let round = 0; round < 5; round += 1) {
        for (const resource of resources) {
          window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
            detail: {
              rendererId: resource.type,
              resourceId: resource.id,
              sessionId: ${JSON.stringify(sessionId)}
            }
          }))
        }
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const active = document.querySelector('[data-workbench-view][data-active="true"]')
      return {
        rendererId: active?.dataset.workbenchView,
        resourceId: Number(active?.dataset.resourceId),
        activeViews: document.querySelectorAll('[data-workbench-view][data-active="true"]').length,
        totalViews: document.querySelectorAll('[data-workbench-view]').length
      }
    })()`)
    await wait(300)
    const performance = await stopProbe()
    rapidTabSwitching = {
      durationMs: (await evaluate(`performance.now()`)) - rapidStartedAt,
      switches: workbenchResources.resources.length * 5,
      state: rapidState,
      performance
    }
    const lastResource = workbenchResources.resources.at(-1)
    assert.deepEqual(
      { rendererId: rapidState.rendererId, resourceId: rapidState.resourceId },
      { rendererId: lastResource.type, resourceId: lastResource.id },
      'rapid switching must settle on the last requested tab'
    )
    assert.equal(rapidState.activeViews, 1, 'rapid switching must leave one active view')
    assert.equal(rapidState.totalViews, 10, 'rapid switching must not duplicate or lose views')
    assert.ok(performance.maxMs < 250, `rapid switching blocked a frame for ${performance.maxMs}ms`)
  }

  if (stopAfterPhase >= 8) {
    await cdp.send('HeapProfiler.collectGarbage')
    const beforeHeap = await cdp.send('Runtime.getHeapUsage')
    const before = await evaluate(`(() => ({
      domNodes: document.querySelectorAll('*').length,
      totalViews: document.querySelectorAll('[data-workbench-view]').length
    }))()`)
    await evaluate(`(async () => {
      const resources = ${JSON.stringify(workbenchResources.resources)}
      for (let round = 0; round < 10; round += 1) {
        for (const resource of resources) {
          window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
            detail: {
              rendererId: resource.type,
              resourceId: resource.id,
              sessionId: ${JSON.stringify(sessionId)}
            }
          }))
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
      }
    })()`)
    await wait(500)
    await cdp.send('HeapProfiler.collectGarbage')
    const afterHeap = await cdp.send('Runtime.getHeapUsage')
    const after = await evaluate(`(async () => ({
      domNodes: document.querySelectorAll('*').length,
      totalViews: document.querySelectorAll('[data-workbench-view]').length,
      activeViews: document.querySelectorAll('[data-workbench-view][data-active="true"]').length,
      resources: (await window.bridge.invoke('resource:list', {
        sessionId: ${JSON.stringify(sessionId)}
      })).length
    }))()`)
    repeatedTabSwitching = {
      switches: workbenchResources.resources.length * 10,
      before: { ...before, heapMiB: beforeHeap.usedSize / 1024 / 1024 },
      after: { ...after, heapMiB: afterHeap.usedSize / 1024 / 1024 },
      heapGrowthMiB: (afterHeap.usedSize - beforeHeap.usedSize) / 1024 / 1024,
      domGrowth: after.domNodes - before.domNodes
    }
    assert.equal(after.totalViews, 10, 'repeated switching must preserve 10 views')
    assert.equal(after.resources, 10, 'repeated switching must preserve 10 resources')
    assert.equal(after.activeViews, 1, 'repeated switching must leave one active view')
    assert.ok(repeatedTabSwitching.domGrowth <= 50, 'repeated switching leaked DOM nodes')
    assert.ok(repeatedTabSwitching.heapGrowthMiB <= 16, 'repeated switching leaked over 16 MiB')
  }

  const heap = await cdp.send('Runtime.getHeapUsage')
  const state = await evaluate(`(() => ({
    domNodes: document.querySelectorAll('*').length,
    renderedMessages: document.querySelectorAll('[data-message-index]').length,
    topIndex: Math.min(...[...document.querySelectorAll('[data-message-index]')]
      .map((element) => Number(element.dataset.messageIndex))),
    scrollTop: document.querySelector('[data-message-scroll-viewport]')?.scrollTop
  }))()`)
  assert.equal(state.topIndex, 0, 'the test must finish with the first message rendered')
  console.log(
    JSON.stringify(
      {
        sessionId,
        workbenchResources: {
          created: workbenchResources.created.length,
          removed: workbenchResources.removed,
          total: workbenchResources.resources.length,
          types: Object.fromEntries(
            Object.entries(Object.groupBy(workbenchResources.resources, ({ type }) => type)).map(
              ([type, resources]) => [type, resources.length]
            )
          )
        },
        openMs,
        idle,
        topMs,
        topProgress,
        scrollToTop,
        bidirectionalScroll,
        horizontalResize,
        workbenchCollapse,
        navigationCollapse,
        rapidTabSwitching,
        repeatedTabSwitching,
        heap: {
          usedMiB: heap.usedSize / 1024 / 1024,
          totalMiB: heap.totalSize / 1024 / 1024
        },
        state
      },
      null,
      2
    )
  )
  assert.equal(
    performanceRegressions.length,
    0,
    `performance regressions:\n- ${performanceRegressions.join('\n- ')}`
  )
} finally {
  cdp.close()
}
