/* eslint-disable @typescript-eslint/explicit-function-return-type */
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const cycles = Number(process.env.LARIFY_MATRIX_CYCLES ?? 10)
const heapGrowthLimit = Number(process.env.LARIFY_MATRIX_HEAP_GROWTH_BYTES ?? 32 * 1024 * 1024)
const targetUrl = `http://127.0.0.1:${port}/json/list`
const targets = await fetch(targetUrl).then((response) => {
  if (!response.ok) throw new Error(`CDP target request failed: ${response.status}`)
  return response.json()
})
const target = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
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
  if (message.error) command.reject(new Error(message.error.message))
  else command.resolve(message.result)
})

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++commandId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const heapSize = async () => {
  const { metrics } = await send('Performance.getMetrics')
  return metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? 0
}

async function ensureWorkbenchOpen() {
  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.getAttribute('aria-label') === '显示工作台'
    )
    button?.click()
  })()`)
  await wait(100)
}

async function exerciseDivider() {
  const geometry = await evaluate(`(() => {
    const handle = document.querySelector('.larify-workbench-resize-handle')
    const rect = handle?.getBoundingClientRect()
    return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)
  if (!geometry) throw new Error('Workbench resize handle is unavailable')

  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    type: 'mousePressed',
    x: geometry.x,
    y: geometry.y
  })
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    type: 'mouseMoved',
    x: geometry.x - 80,
    y: geometry.y
  })
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    type: 'mouseReleased',
    x: geometry.x - 80,
    y: geometry.y
  })
  await evaluate(`(() => {
    const handle = document.querySelector('.larify-workbench-resize-handle')
    handle?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
    handle?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  })()`)
}

async function assertLayout(name) {
  const state = await evaluate(`(() => {
    const interaction = document.querySelector('.larify-interaction-pane')?.getBoundingClientRect()
    const workbench = document.querySelector('.larify-workbench-pane')?.getBoundingClientRect()
    const handle = document.querySelector('.larify-workbench-resize-handle')?.getBoundingClientRect()
    return {
      bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      domNodes: document.getElementsByTagName('*').length,
      handleVisible: Boolean(handle?.width && handle?.height),
      interactionWidth: interaction?.width ?? 0,
      workbenchWidth: workbench?.width ?? 0
    }
  })()`)
  if (state.bodyOverflow) throw new Error(`${name}: document overflowed horizontally`)
  if (!state.handleVisible) throw new Error(`${name}: resize handle is not visible`)
  if (state.interactionWidth <= 0 || state.workbenchWidth <= 0) {
    throw new Error(`${name}: a workbench pane has no layout width`)
  }
  await send('Page.captureScreenshot', { format: 'png' })
  return state
}

await send('Page.enable')
await send('Performance.enable')
const cases = [
  { height: 600, name: 'compact', width: 800 },
  { height: 800, name: 'standard', width: 1280 },
  { height: 1200, name: 'wide', width: 2400 }
]
const scales = [1, 1.25, 1.5, 2]
const results = []

try {
  await ensureWorkbenchOpen()
  const environment = await evaluate(`({
    devicePixelRatio,
    screenX,
    screenY,
    screen: {
      availHeight: screen.availHeight,
      availWidth: screen.availWidth,
      height: screen.height,
      width: screen.width
    }
  })`)
  const heapBefore = await heapSize()
  for (const testCase of cases) {
    for (const deviceScaleFactor of scales) {
      await send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor,
        height: testCase.height,
        mobile: false,
        width: testCase.width
      })
      await exerciseDivider()
      results.push({
        deviceScaleFactor,
        name: testCase.name,
        ...(await assertLayout(`${testCase.name}@${deviceScaleFactor}`))
      })
    }
  }

  await send('Emulation.clearDeviceMetricsOverride')
  await assertLayout('restored-device-metrics')

  for (let cycle = 0; cycle < cycles; cycle += 1) await exerciseDivider()
  await evaluate(`globalThis.gc?.()`)
  const heapAfter = await heapSize()
  const heapGrowth = heapAfter - heapBefore
  if (heapGrowth > heapGrowthLimit) {
    throw new Error(`Heap grew by ${heapGrowth} bytes; limit is ${heapGrowthLimit}`)
  }
  console.log(
    JSON.stringify({ cycles, environment, heapAfter, heapBefore, heapGrowth, results }, null, 2)
  )
} finally {
  await send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
  socket.close()
}
