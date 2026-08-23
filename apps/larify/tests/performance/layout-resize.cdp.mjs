/* eslint-disable @typescript-eslint/explicit-function-return-type */
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const targetUrl = `http://127.0.0.1:${port}/json/list`
const moveCount = 30
const limits = { styleMs: 20, taskMs: 150 }
const commandTimeout = Number(process.env.LARIFY_PERF_COMMAND_TIMEOUT ?? 10_000)
const selectedCase = process.env.LARIFY_PERF_CASE
const sampleCount = Number(process.env.LARIFY_PERF_SAMPLES ?? 3)

const targets = await fetch(targetUrl).then((response) => {
  if (!response.ok) throw new Error(`CDP target request failed: ${response.status}`)
  return response.json()
})
const target = targets.find(
  ({ type, url }) =>
    type === 'page' &&
    (url.startsWith('http://localhost:') || url.endsWith('/out/renderer/index.html'))
)
if (!target?.webSocketDebuggerUrl) throw new Error(`Larify page not found at ${targetUrl}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})

let commandId = 0
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  const command = pending.get(message.id)
  if (!command) return
  pending.delete(message.id)
  clearTimeout(command.timer)
  if (message.error) command.reject(new Error(message.error.message))
  else command.resolve(message.result)
})

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++commandId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP command timed out: ${method}${params.type ? ` (${params.type})` : ''}`))
    }, commandTimeout)
    pending.set(id, { reject, resolve, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  }
  return response.result.value
}

function metricsByName(metrics) {
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]))
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

async function dragSeparator(selector, direction) {
  const wallStarted = performance.now()
  const position = await evaluate(`(() => {
    const separator = document.querySelector(${JSON.stringify(selector)})
    if (!separator) throw new Error('${selector} separator not found')
    const rect = separator.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: Math.min(500, rect.height / 2) }
  })()`)
  const before = metricsByName((await send('Performance.getMetrics')).metrics)
  let pressed = false
  try {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: position.x,
      y: position.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    pressed = true
    for (let index = 1; index <= moveCount / 2; index += 1) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: position.x + direction * index * 6,
        y: position.y,
        button: 'left',
        buttons: 1
      })
      await wait(8)
    }
    for (let index = moveCount / 2 - 1; index >= 0; index -= 1) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: position.x + direction * index * 6,
        y: position.y,
        button: 'left',
        buttons: 1
      })
      await wait(8)
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: position.x,
      y: position.y,
      button: 'left',
      buttons: 0
    })
    pressed = false
  } finally {
    if (pressed) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: position.x,
        y: position.y,
        button: 'left',
        buttons: 0
      }).catch(() => undefined)
    }
  }

  const after = metricsByName((await send('Performance.getMetrics')).metrics)
  return {
    styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1_000,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1_000,
    wallMs: performance.now() - wallStarted
  }
}

let originalTabIds = []
try {
  await send('Performance.enable')
  await evaluate(`document.querySelector('[aria-label="显示工作台"]')?.click()`)
  await wait(100)
  if (process.env.LARIFY_PERF_HIDE_MESSAGES === '1') {
    await evaluate(
      `document.querySelector('[role="log"]')?.style.setProperty('content-visibility', 'hidden')`
    )
  }
  if (process.env.LARIFY_PERF_HIDE_PANELS === '1') {
    await evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'larify-perf-hide-panels'
      style.textContent = '.larify-workbench-split > div, .larify-workbench-pane > div { content-visibility: hidden !important; }'
      document.head.append(style)
    })()`)
  }
  originalTabIds = await evaluate(
    `Array.from(document.querySelectorAll('[data-tab-id]'), (tab) => tab.dataset.tabId)`
  )
  const cases = [
    {
      direction: 1,
      name: 'navigation',
      selector: '.larify-allotment > .sash-container > .sash'
    },
    {
      direction: -1,
      name: 'workbench-empty',
      selector: '.larify-workbench-resize-handle'
    },
    {
      direction: -1,
      name: 'workbench-10-tabs',
      selector: '.larify-workbench-resize-handle',
      setup: async () => {
        await evaluate(`(() => {
          const create = document.querySelector('.larify-workbench-tab-create')
          for (let index = 0; index < 10; index += 1) create?.click()
        })()`)
        await wait(100)
      }
    }
  ]
  const results = {}
  for (const testCase of cases.filter(({ name }) => !selectedCase || name === selectedCase)) {
    await testCase.setup?.()
    await dragSeparator(testCase.selector, testCase.direction)
    const samples = []
    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await dragSeparator(testCase.selector, testCase.direction))
    }
    const median = (key) => {
      const values = samples.map((sample) => sample[key]).sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)]
    }
    results[testCase.name] = {
      result: { styleMs: median('styleMs'), taskMs: median('taskMs'), wallMs: median('wallMs') },
      samples
    }
  }
  console.log(JSON.stringify({ limits, moveCount, results }, null, 2))

  const regressions = Object.entries(results).filter(
    ([, { result }]) => result.styleMs > limits.styleMs || result.taskMs > limits.taskMs
  )
  if (regressions.length > 0) {
    throw new Error(
      regressions
        .map(
          ([name, { result }]) =>
            `${name}: style ${result.styleMs.toFixed(1)}ms/${limits.styleMs}ms, ` +
            `task ${result.taskMs.toFixed(1)}ms/${limits.taskMs}ms`
        )
        .join('; ')
    )
  }
} finally {
  try {
    await evaluate(`(() => {
      document.querySelector('[role="log"]')?.style.removeProperty('content-visibility')
      document.querySelector('#larify-perf-hide-panels')?.remove()
      const original = new Set(${JSON.stringify(originalTabIds ?? [])})
      for (const tab of document.querySelectorAll('[data-tab-id]')) {
        if (!original.has(tab.dataset.tabId)) tab.querySelector('.larify-workbench-tab-close')?.click()
      }
    })()`)
  } catch {
    // The renderer may be deliberately unresponsive when this regression reproduces.
  }
  socket.close()
}
