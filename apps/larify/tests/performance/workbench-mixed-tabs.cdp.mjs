/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { connectLarifyCdp } from '../manual/cdp-client.mjs'

let sessionId = process.env.LARIFY_WORKBENCH_SESSION_ID
const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const desiredCounts = { browser: 8, changes: 4, terminal: 4, workspace: 4 }
const desiredTotal = Object.values(desiredCounts).reduce((sum, count) => sum + count, 0)
const waitFor = async (expression, label, timeout = 10_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  await waitFor(`Boolean(window.bridge)`, 'bridge')
  if (sessionId) {
    await waitFor(
      `(() => { const button = document.querySelector('button[data-session-id="${sessionId}"]'); button?.click(); return Boolean(button) })()`,
      'configured workbench session'
    )
  } else {
    sessionId = await waitFor(
      `document.querySelector('[data-workbench-session][data-active]')?.getAttribute('data-workbench-session')`,
      'active workbench session'
    )
  }
  const resources = await evaluate(`(async () => {
    const desired = ${JSON.stringify(desiredCounts)}
    const options = {
      workspace: { root: ${JSON.stringify(appRoot)} },
      changes: { root: ${JSON.stringify(appRoot)} },
      terminal: { cwd: ${JSON.stringify(appRoot)} },
      browser: {}
    }
    const existing = await window.bridge.invoke('resource:list', {
      sessionId: ${JSON.stringify(sessionId)}
    })
    const resources = []
    const extras = []
    for (const [type, count] of Object.entries(desired)) {
      const matching = existing.filter((resource) => resource.type === type)
      resources.push(...matching.slice(0, count))
      extras.push(...matching.slice(count))
      for (let index = matching.length; index < count; index += 1) {
        const id = await window.bridge.invoke(
          'resource:create',
          type,
          ${JSON.stringify(sessionId)},
          options[type]
        )
        resources.push({ id, sessionId: ${JSON.stringify(sessionId)}, type })
      }
    }
    extras.push(...existing.filter((resource) => !(resource.type in desired)))
    if (extras.length) {
      await window.bridge.invoke('resource:close-many', extras.map(({ id }) => id))
    }
    return resources
  })()`)
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(Object.groupBy(resources, ({ type }) => type)).map(([type, values]) => [
        type,
        values.length
      ])
    ),
    desiredCounts
  )
  const browserUrls = [
    'https://example.com/',
    'https://www.wikipedia.org/',
    'https://github.com/',
    'https://developer.mozilla.org/',
    'https://nodejs.org/',
    'https://www.typescriptlang.org/',
    'https://www.electronjs.org/',
    'https://react.dev/'
  ]
  const browsers = resources.filter(({ type }) => type === 'browser')
  for (let index = 0; index < browsers.length; index += 1) {
    await evaluate(
      `window.bridge.invoke('browser:navigate', ${JSON.stringify(sessionId)}, ${browsers[index].id}, ${JSON.stringify(browserUrls[index])})`
    )
    await waitFor(
      `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(sessionId)}, ${browsers[index].id}))?.url?.startsWith('http'))()`,
      `browser:${browsers[index].id} real URL`
    )
  }

  const select = async (resource) => {
    const started = await evaluate('performance.now()')
    await evaluate(`new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
        detail: { rendererId: ${JSON.stringify(resource.type)}, resourceId: ${resource.id}, sessionId: ${JSON.stringify(sessionId)} }
      }))
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })`)
    return (await evaluate('performance.now()')) - started
  }
  const contentReady = (resource) => {
    const root = `[data-workbench-view="${resource.type}"][data-resource-id="${resource.id}"][data-active]`
    if (resource.type === 'workspace')
      return `${JSON.stringify(root)} && (() => { const view = document.querySelector(${JSON.stringify(root)}); return view?.querySelectorAll('.workspace-file-preview .view-line').length > 0 && Boolean(view.querySelector('.rc-tree-treenode-selected')) })()`
    if (resource.type === 'changes')
      return `(() => { const view = document.querySelector(${JSON.stringify(root)}); const title = document.querySelector('[data-workbench-session][data-active] .larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent?.trim(); return view?.querySelectorAll('.workspace-file-preview .view-line').length > 0 && title && title !== '变更' })()`
    if (resource.type === 'terminal')
      return `Boolean(document.querySelector(${JSON.stringify(`${root} .larify-terminal-surface[data-terminal-active="true"] .xterm-rows`)}))`
    return `(async () => { const view = document.querySelector(${JSON.stringify(root)}); const state = await window.bridge.invoke('browser:getState', ${JSON.stringify(sessionId)}, ${resource.id}); return Boolean(view && state?.url?.startsWith('http') && state?.title) })()`
  }

  for (const resource of resources) {
    await select(resource)
    if (resource.type === 'workspace') {
      await waitFor(
        `Boolean(document.querySelector('[data-workbench-view="workspace"][data-resource-id="${resource.id}"][data-active] .rc-tree-treenode'))`,
        `workspace:${resource.id} tree`
      )
      for (let depth = 0; depth < 4; depth += 1) {
        const expanded = await evaluate(`(() => {
          const view = document.querySelector('[data-workbench-view="workspace"][data-resource-id="${resource.id}"][data-active]')
          if ([...(view?.querySelectorAll('.rc-tree-treenode:not([aria-expanded])') ?? [])].some((node) => /\\.(?:css|html|js|json|md|mjs|ts|tsx|txt)$/i.test(node.textContent ?? ''))) return false
          const node = view?.querySelector('.rc-tree-treenode[aria-expanded="false"] .rc-tree-node-content-wrapper')
          node?.click()
          return Boolean(node)
        })()`)
        if (!expanded) break
        await wait(100)
      }
      const clicked = await evaluate(`(() => {
        const view = document.querySelector('[data-workbench-view="workspace"][data-resource-id="${resource.id}"][data-active]')
        if (view?.querySelector('.rc-tree-treenode-selected')) return true
        const leaf = [...(view?.querySelectorAll('.rc-tree-treenode:not([aria-expanded]) .rc-tree-node-content-wrapper') ?? [])]
          .find((node) => /\\.(?:css|html|js|json|md|mjs|ts|tsx|txt)$/i.test(node.textContent ?? ''))
        leaf?.click()
        return Boolean(leaf)
      })()`)
      assert.ok(clicked, `workspace:${resource.id} must expose a source file`)
    }
    await waitFor(contentReady(resource), `${resource.type}:${resource.id} real content`)
  }

  await wait(1_000)
  await cdp.send('Performance.enable')
  const idleMetricsBefore = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value])
  )
  await evaluate(`(() => {
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
    window.__workbenchIdleProbe = probe
    requestAnimationFrame(frame)
  })()`)
  await wait(5_000)
  const idle = await evaluate(`(() => {
    const probe = window.__workbenchIdleProbe
    probe.running = false
    probe.observer.disconnect()
    const frames = probe.frames.toSorted((left, right) => left - right)
    return {
      p95Ms: frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))] ?? 0,
      maxMs: Math.max(0, ...frames),
      longTasks: probe.longTasks.length,
      maxLongTaskMs: Math.max(0, ...probe.longTasks)
    }
  })()`)
  const idleMetricsAfter = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value])
  )
  idle.rendererTaskMs = (idleMetricsAfter.TaskDuration - idleMetricsBefore.TaskDuration) * 1_000
  const idleFailures = [
    idle.p95Ms >= 25 ? `idle frame p95 regressed to ${idle.p95Ms.toFixed(1)}ms` : null,
    idle.maxLongTaskMs >= 50
      ? `idle generated a ${idle.maxLongTaskMs.toFixed(1)}ms long task`
      : null,
    idle.rendererTaskMs >= 300 ? `idle renderer used ${idle.rendererTaskMs.toFixed(1)}ms` : null
  ].filter(Boolean)

  const before = await evaluate(`({
    nodes: document.querySelectorAll('*').length,
    views: document.querySelectorAll('[data-workbench-view]').length,
    active: document.querySelectorAll('[data-workbench-view][data-active]').length
  })`)
  await cdp.send('HeapProfiler.collectGarbage')
  const beforeHeap = await cdp.send('Runtime.getHeapUsage')
  const toggle = async (hide, show, hidden, visible) => {
    assert.ok(
      await evaluate(
        `(() => { const button = document.querySelector('[aria-label="${hide}"]'); button?.click(); return Boolean(button) })()`
      )
    )
    await waitFor(hidden, hide)
    assert.ok(
      await evaluate(
        `(() => { const button = document.querySelector('[aria-label="${show}"]'); button?.click(); return Boolean(button) })()`
      )
    )
    await waitFor(visible, show)
  }
  await toggle(
    '隐藏工作台',
    '显示工作台',
    `document.querySelector('.larify-workbench-pane')?.getBoundingClientRect().width === 0`,
    `document.querySelector('.larify-workbench-pane')?.getBoundingClientRect().width > 0`
  )
  await toggle(
    '隐藏侧边栏',
    '显示侧边栏',
    `Boolean(document.querySelector('[aria-label="显示侧边栏"]'))`,
    `Boolean(document.querySelector('[aria-label="隐藏侧边栏"]'))`
  )

  const switches = []
  for (let round = 0; round < 5; round += 1) {
    for (const resource of resources) {
      switches.push({ round, type: resource.type, id: resource.id, ms: await select(resource) })
      await wait(100)
    }
  }
  const after = await evaluate(`({
    nodes: document.querySelectorAll('*').length,
    views: document.querySelectorAll('[data-workbench-view]').length,
    active: document.querySelectorAll('[data-workbench-view][data-active]').length
  })`)
  await cdp.send('HeapProfiler.collectGarbage')
  const afterHeap = await cdp.send('Runtime.getHeapUsage')
  assert.equal(after.views, desiredTotal, 'switching must preserve all views')
  assert.equal(after.active, 1, 'switching must leave one active view')
  assert.ok(
    after.nodes - before.nodes <= 50,
    `switching leaked ${after.nodes - before.nodes} DOM nodes`
  )
  for (const resource of resources) {
    await select(resource)
    await waitFor(contentReady(resource), `${resource.type}:${resource.id} content after switching`)
  }

  const warm = switches.filter(({ round }) => round > 0)
  const percentile = (values, fraction) => {
    const sorted = values.toSorted((left, right) => left - right)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
  }
  const byType = Object.fromEntries(
    Object.entries(Object.groupBy(warm, ({ type }) => type)).map(([type, values]) => [
      type,
      {
        maxMs: Math.max(...values.map(({ ms }) => ms)),
        averageMs: values.reduce((sum, { ms }) => sum + ms, 0) / values.length,
        p95Ms: percentile(
          values.map(({ ms }) => ms),
          0.95
        )
      }
    ])
  )
  const heapGrowthMiB = (afterHeap.usedSize - beforeHeap.usedSize) / 1024 / 1024
  console.log(JSON.stringify({ before, after, byType, heapGrowthMiB, idle, switches }, null, 2))
  assert.deepEqual(idleFailures, [], idleFailures.join('; '))
  assert.ok(byType.workspace.averageMs < 125, 'workspace warm-switch average reached 125ms')
  assert.ok(byType.browser.averageMs < 110, 'browser warm-switch average reached 110ms')
  assert.ok(byType.browser.maxMs < 200, 'browser backing-store regression reached 200ms')
  assert.ok(byType.changes.averageMs < 175, 'changes warm-switch average reached 175ms')
  assert.ok(byType.terminal.averageMs < 150, 'terminal warm-switch average reached 150ms')
  assert.ok(byType.changes.maxMs < 300, 'a changes warm switch reached 300ms')
  assert.ok(byType.terminal.maxMs < 250, 'a terminal warm switch reached 250ms')
  assert.ok(
    Object.values(byType).every(({ maxMs }) => maxMs < 300),
    'a warm switch reached 300ms'
  )
  assert.ok(heapGrowthMiB <= 16, `switching retained ${heapGrowthMiB.toFixed(1)} MiB`)
} finally {
  cdp.close()
}
