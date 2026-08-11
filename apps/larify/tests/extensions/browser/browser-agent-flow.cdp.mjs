/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
)
const target = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
)
if (!target?.webSocketDebuggerUrl) throw new Error(`Larify page not found on port ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.once('open', resolveOpen)
  socket.once('error', reject)
})
let id = 0
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
  new Promise((resolveCommand, reject) => {
    const commandId = ++id
    pending.set(commandId, { resolve: resolveCommand, reject })
    socket.send(JSON.stringify({ id: commandId, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description)
  return result.result.value
}
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
const waitFor = async (expression, label, timeout = 120_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out: ${label}`)
}

const previousSessionId = await evaluate(`localStorage.getItem('larify.activeSessionId')`)
if (previousSessionId) {
  await evaluate(`window.bridge.invoke('agent:cancel', ${JSON.stringify(previousSessionId)})`)
}
await send('Page.reload', { ignoreCache: true })
await waitFor('Boolean(window.bridge)', 'renderer reload', 10_000)
await wait(500)
assert.equal(
  await waitFor(
    `(() => {
    const button = document.querySelector('.lucide-message-circle-plus')?.closest('button')
    button?.click()
    return Boolean(button)
  })()`,
    'new task button',
    10_000
  ),
  true
)
const initialResources = await evaluate(`window.bridge.invoke('resource:list')`)
const marker = `LARIFY_BROWSER_AGENT_${Date.now()}`
const fixture = resolve('tests/extensions/browser/fixtures/interaction.html')
const prompt = [
  '这是浏览器自动化端到端测试，必须实际调用工具，不要用终端或其他工具替代。',
  '请严格依次调用 browser_list_tabs、browser_create_tab、browser_read_page、browser_fill、browser_click、browser_query_element、browser_scroll、browser_screenshot、browser_close_tab。',
  `browser_create_tab 打开本地文件 ${fixture}，只能创建一个浏览器标签页。`,
  `用 browser_fill 将 #text 填为 ${marker}，点击 #increment，再读取 #count 的 value 并确认等于 1。`,
  '向下滚动页面并截图，然后关闭刚创建的浏览器标签页。',
  `最终回复必须包含 ${marker} 和数字 1。`
].join(' ')

try {
  await send('Page.bringToFront')
  await waitFor(
    `(() => {
    const textarea = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    return Boolean(textarea && !textarea.disabled && textarea.getBoundingClientRect().width > 0)
  })()`,
    'visible assistant composer',
    10_000
  )
  const inserted = await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    if (!(textarea instanceof HTMLTextAreaElement)) return null
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      textarea,
      ${JSON.stringify(prompt)}
    )
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    return textarea.value
  })()`)
  assert.equal(inserted, prompt)
  assert.equal(
    await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    const form = textarea?.closest('form')
    form?.requestSubmit()
    return Boolean(form)
  })()`),
    true
  )

  const observed = { resource: false, tab: false, title: false }
  let sessionId = null
  const started = Date.now()
  while (Date.now() - started < 120_000) {
    const state = await evaluate(`(async () => ({
      resources: await window.bridge.invoke('resource:list'),
      tabs: [...document.querySelectorAll('.larify-workbench-tab-title')].map((node) => node.textContent),
      active: Boolean(document.querySelector('[data-testid="run-active"]')),
      failed: Boolean(document.querySelector('[data-testid="run-failed"]')),
      reply: [...document.querySelectorAll('.is-assistant')].some((node) =>
        node.textContent.includes(${JSON.stringify(marker)})
      )
    }))()`)
    const created = state.resources.filter(
      ({ id }) => !initialResources.some((resource) => resource.id === id)
    )
    sessionId ??= created.find(({ type }) => type === 'browser')?.sessionId ?? null
    observed.resource ||= created.some(({ type }) => type === 'browser')
    observed.tab ||= state.tabs.length > 0
    observed.title ||= state.tabs.includes('Browser Interaction Test')
    if (observed.resource && created.length === 0 && (state.reply || state.failed) && !state.active)
      break
    await wait(100)
  }

  assert.equal(observed.resource, true, 'Agent should create a browser resource')
  assert.equal(observed.tab, true, 'Agent browser should appear in the workbench')
  assert.equal(observed.title, true, 'Agent browser should publish its page title')
  assert.ok(sessionId, 'Agent browser resource should expose its session id')
  await waitFor(
    `[...document.querySelectorAll('.is-assistant')].some((node) =>
      node.textContent.includes(${JSON.stringify(marker)})
    )`,
    'Agent final response'
  )
  await waitFor(
    `(async () => {
      const resources = await window.bridge.invoke('resource:list')
      return !resources.some(({ id }) => !${JSON.stringify(initialResources.map(({ id }) => id))}.includes(id))
    })()`,
    'Agent browser cleanup'
  )

  const calls = await evaluate(`(async () => {
    const messages = await window.bridge.invoke('session:msgs', ${JSON.stringify(sessionId)})
    return messages.flatMap(({ parts = [] }) => parts
      .filter(({ type }) => type.startsWith('tool-browser_'))
      .map(({ type, input, output }) => ({ type, input, output })))
  })()`)
  const called = new Set(calls.map(({ type }) => type.replace('tool-browser_', '')))
  for (const name of [
    'list_tabs',
    'create_tab',
    'read_page',
    'fill',
    'click',
    'query_element',
    'scroll',
    'screenshot',
    'close_tab'
  ]) {
    assert.equal(called.has(name), true, `Agent should call browser_${name}`)
  }
  assert.ok(
    calls.some(
      ({ type, output }) =>
        type === 'tool-browser_query_element' && (JSON.stringify(output) ?? '').includes('1')
    ),
    'Agent should observe the incremented value'
  )

  console.log(JSON.stringify({ marker, observed, sessionId, tools: [...called] }, null, 2))
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
