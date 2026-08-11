/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const targetUrl = `http://127.0.0.1:${port}/json/list`
const targets = await fetch(targetUrl).then((response) => response.json())
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

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++commandId
    pending.set(id, { reject, resolve })
    socket.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description)
  return response.result.value
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

async function waitFor(expression, message, timeout = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out: ${message}`)
}

async function clickSelector(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (!point) return false
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    type: 'mousePressed',
    ...point
  })
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    type: 'mouseReleased',
    ...point
  })
  return true
}

const marker = `LARIFY_AGENT_E2E_${Date.now()}`
for (const id of (process.env.LARIFY_CLEAN_RESOURCE_IDS ?? '')
  .split(',')
  .map(Number)
  .filter(Number.isSafeInteger)) {
  await evaluate(`window.bridge.invoke('resource:close', ${id})`)
}
const previousSessionId = await evaluate(`localStorage.getItem('larify.activeSessionId')`)
if (previousSessionId) {
  await evaluate(`window.bridge.invoke('agent:cancel', ${JSON.stringify(previousSessionId)})`)
}
await send('Page.reload', { ignoreCache: true })
await waitFor(`Boolean(window.bridge)`, 'renderer reload', 10_000)
await wait(500)
const createdSession = await waitFor(
  `(() => {
  const button = document.querySelector('.lucide-message-circle-plus')?.closest('button')
  button?.click()
  return Boolean(button)
})()`,
  'new task button',
  10_000
)
assert.equal(createdSession, true, 'new task button should exist')
const sessionId = await waitFor(
  `localStorage.getItem('larify.activeSessionId')`,
  'active Agent session',
  5_000
)
const initialResources = await evaluate(`window.bridge.invoke('resource:list')`)
const prompt = [
  '这是自动化端到端测试。',
  '必须依次实际调用 terminal_list、terminal_create、terminal_write、terminal_read、terminal_close，且 terminal_create 只能调用一次，不能跳过工具调用。调用 terminal_write 时必须省略 submit 字段，用于验证默认提交行为。',
  `在新终端输出精确文本 ${marker}，输出后等待 5 秒再结束命令，读取并确认输出，然后关闭该终端。`,
  `最后回复中必须包含 ${marker}。`
].join(' ')

try {
  await send('Page.bringToFront')
  await waitFor(
    `(() => {
      const element = [...document.querySelectorAll('form textarea')]
        .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
      if (!element || element.disabled) return null
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })()`,
    'visible assistant composer',
    10_000
  )
  const inserted = await evaluate(`(() => {
    const element = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    if (!(element instanceof HTMLTextAreaElement)) return null
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    setter?.call(element, ${JSON.stringify(prompt)})
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: ${JSON.stringify(prompt)},
      inputType: 'insertText'
    }))
    return element.value
  })()`)
  assert.equal(inserted, prompt, 'Agent prompt should be written exactly')
  const submitted = await evaluate(`(() => {
    const element = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    const form = element?.closest('form')
    form?.requestSubmit()
    return Boolean(form)
  })()`)
  assert.equal(submitted, true, 'Agent composer should submit')

  const observed = { resource: false, tab: false, terminalOutput: false }
  let activatedTab = false
  let finalState = null
  const started = Date.now()
  while (Date.now() - started < 120_000) {
    const state = await evaluate(`(async () => ({
      resources: await window.bridge.invoke('resource:list'),
      tabs: document.querySelectorAll('.larify-workbench-tab').length,
      terminal: document.querySelectorAll('.xterm-rows').length > 0 &&
        [...document.querySelectorAll('.xterm-rows')].some((node) =>
          node.textContent.includes(${JSON.stringify(marker)})
        ),
      active: Boolean(document.querySelector('[data-testid="run-active"]')),
      activeSessionId: localStorage.getItem('larify.activeSessionId'),
      failed: Boolean(document.querySelector('[data-testid="run-failed"]')),
      assistantText: [...document.querySelectorAll('.is-assistant')]
        .map((node) => node.textContent).join('\\n'),
      reply: [...document.querySelectorAll('.is-assistant')].some((node) =>
        node.textContent.includes(${JSON.stringify(marker)})
      )
    }))()`)
    finalState = state
    observed.resource ||= state.resources.some(
      ({ id }) => !initialResources.some((resource) => resource.id === id)
    )
    const hasCreatedResource = state.resources.some(
      ({ id }) => !initialResources.some((resource) => resource.id === id)
    )
    observed.tab ||= state.tabs > 0
    if (observed.tab && !activatedTab) {
      const workbenchVisible = await evaluate(`(() => {
        const home = document.querySelector('.larify-workbench-home')
        const rect = home?.getBoundingClientRect()
        return Boolean(home && rect && rect.width > 0 && rect.height > 0 &&
          getComputedStyle(home).visibility !== 'hidden')
      })()`)
      if (!workbenchVisible) {
        await clickSelector('.lucide-panel-right-open')
        await wait(300)
      }
      activatedTab = await clickSelector(
        '.larify-workbench-tab:last-of-type .larify-workbench-tab-trigger'
      )
    }
    observed.terminalOutput ||= state.terminal
    if (
      observed.resource &&
      !hasCreatedResource &&
      (state.reply || state.failed) &&
      !state.active
    ) {
      break
    }
    await wait(100)
  }

  if (!observed.resource || !observed.tab || !observed.terminalOutput) {
    console.error(JSON.stringify({ finalState, marker, observed }, null, 2))
  }
  assert.equal(observed.resource, true, 'Agent should create a terminal resource')
  assert.equal(observed.tab, true, 'Agent terminal should appear as a workbench tab')
  assert.equal(observed.terminalOutput, true, 'Agent command output should reach the terminal view')
  await waitFor(
    `(() => [...document.querySelectorAll('.is-assistant')].some((node) =>
      node.textContent.includes(${JSON.stringify(marker)})
    ))()`,
    'Agent final response'
  )
  await waitFor(
    `(async () => {
      const current = await window.bridge.invoke('resource:list')
      return !current.some(({ id }) =>
        !${JSON.stringify(initialResources.map(({ id }) => id))}.includes(id)
      )
    })()`,
    'Agent terminal cleanup'
  )

  const writeInputs = await evaluate(`(async () => {
    const messages = await window.bridge.invoke('session:msgs', ${JSON.stringify(sessionId)})
    return messages.flatMap(({ parts = [] }) => parts
      .filter(({ type }) => type === 'tool-terminal_write')
      .map(({ input }) => input))
  })()`)
  assert.ok(writeInputs.length > 0, 'Agent should persist a terminal_write call')
  assert.equal(
    writeInputs.every((input) => input.submit === true),
    true,
    'Agent terminal_write should resolve the default submit value to true'
  )

  console.log(JSON.stringify({ marker, observed, sessionId, writeInputs }, null, 2))
} finally {
  const remaining = await evaluate(`window.bridge.invoke('resource:list')`)
  const initialIds = new Set(initialResources.map(({ id }) => id))
  for (const resource of remaining) {
    if (!initialIds.has(resource.id)) {
      await evaluate(`window.bridge.invoke('resource:close', ${resource.id})`).catch(
        () => undefined
      )
    }
  }
  socket.close()
}
