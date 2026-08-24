/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const configuredSessionId = process.env.LARIFY_WORKBENCH_SESSION_ID

const metrics = async () =>
  Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value])
  )

const delta = (before, after, name) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1_000

const select = async (resource) => {
  const before = await metrics()
  const elapsed = await evaluate(`new Promise((resolve) => {
    const started = performance.now()
    window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
      detail: ${JSON.stringify({ rendererId: resource.type, resourceId: resource.id, sessionId: resource.sessionId })}
    }))
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)))
  })`)
  const after = await metrics()
  return {
    elapsed,
    layoutMs: delta(before, after, 'LayoutDuration'),
    scriptMs: delta(before, after, 'ScriptDuration'),
    styleMs: delta(before, after, 'RecalcStyleDuration'),
    taskMs: delta(before, after, 'TaskDuration')
  }
}

const measureIdle = async (label) => {
  await wait(500)
  const before = await metrics()
  await wait(3_000)
  const after = await metrics()
  return {
    label,
    layoutMs: delta(before, after, 'LayoutDuration'),
    scriptMs: delta(before, after, 'ScriptDuration'),
    styleMs: delta(before, after, 'RecalcStyleDuration'),
    taskMs: delta(before, after, 'TaskDuration')
  }
}

const profileSelect = async (resource) => {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  await cdp.send('Profiler.start')
  const timing = await select(resource)
  const { profile } = await cdp.send('Profiler.stop')
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const selfTime = new Map()
  for (let index = 0; index < profile.samples.length; index += 1) {
    const id = profile.samples[index]
    selfTime.set(id, (selfTime.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1_000)
  }
  const hottest = [...selfTime]
    .map(([id, selfMs]) => {
      const frame = nodes.get(id)?.callFrame
      return {
        column: frame?.columnNumber,
        function: frame?.functionName || '(anonymous)',
        line: frame?.lineNumber,
        selfMs,
        url: frame?.url
      }
    })
    .toSorted((left, right) => right.selfMs - left.selfMs)
    .slice(0, 20)
  return { hottest, timing }
}

try {
  await cdp.send('Performance.enable')
  if (configuredSessionId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const selected = await evaluate(`(() => {
        const button = document.querySelector('button[data-session-id=${JSON.stringify(configuredSessionId)}]')
        button?.click()
        return Boolean(button)
      })()`)
      if (selected) break
      const more = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '更多')
        button?.click()
        return Boolean(button)
      })()`)
      if (!more) throw new Error(`Configured session not found: ${configuredSessionId}`)
      await wait(150)
    }
    await wait(250)
  }
  const sessionId =
    configuredSessionId ??
    (await evaluate(
      `document.querySelector('[data-workbench-session][data-active]')?.getAttribute('data-workbench-session')`
    ))
  const resources = await evaluate(
    `window.bridge.invoke('resource:list', { sessionId: ${JSON.stringify(sessionId)} })`
  )
  const representatives = Object.values(Object.groupBy(resources, ({ type }) => type)).flatMap(
    (items) => items.slice(0, 1)
  )
  const nodeCounts = await evaluate(`Object.fromEntries(
    ['browser', 'changes', 'terminal', 'workspace'].map((type) => [type,
      [...document.querySelectorAll('[data-workbench-view="' + type + '"]')]
        .map((view) => view.querySelectorAll('*').length)
    ])
  )`)
  const idle = []
  const switching = []
  for (const resource of representatives) {
    switching.push({ type: resource.type, ...(await select(resource)) })
    idle.push(await measureIdle(resource.type))
  }
  const workspace = representatives.find(({ type }) => type === 'workspace')
  const browser = representatives.find(({ type }) => type === 'browser')
  if (workspace && browser) await select(browser)
  const workspaceProfile = workspace ? await profileSelect(workspace) : null
  const hideButton = await evaluate(
    `document.querySelector('[aria-label="隐藏工作台"]')?.click(); Boolean(document.querySelector('[aria-label="隐藏工作台"]'))`
  )
  if (hideButton) {
    await wait(250)
    idle.push(await measureIdle('workbench-collapsed'))
    await evaluate(`document.querySelector('[aria-label="显示工作台"]')?.click()`)
  }
  console.log(
    JSON.stringify(
      { idle, nodeCounts, resources: resources.length, sessionId, switching, workspaceProfile },
      null,
      2
    )
  )
} finally {
  cdp.close()
}
