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

async function waitFor(expression, message, timeout = 5_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${message}`)
}

async function openLauncher() {
  if (await evaluate(`Boolean(document.querySelector('[data-testid="workbench-empty"]'))`)) return
  await evaluate(`document.querySelector('button[title="工作台首页"]')?.click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="workbench-empty"]'))`,
    'workbench launcher'
  )
}

async function createTerminal(createdIds) {
  await openLauncher()
  const before = await evaluate(`window.bridge.invoke('resource:list')`)
  const opened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === '终端'
    )
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(opened, true, 'terminal launcher button should exist')
  const resources = await waitFor(
    `(async () => {
      const resources = await window.bridge.invoke('resource:list')
      return resources.length > ${before.length} ? resources : null
    })()`,
    'terminal resource creation'
  )
  const created = resources.find(({ id }) => !before.some((resource) => resource.id === id))
  assert.ok(created, 'new terminal resource should be identifiable')
  createdIds.push(created.id)
  await waitFor(`Boolean(document.querySelector('.xterm'))`, 'xterm mount')
  await waitFor(`Boolean(document.querySelector('.xterm-helper-textarea'))`, 'xterm input mount')
  return created
}

const initialResources = await evaluate(`window.bridge.invoke('resource:list')`)
const createdIds = []

try {
  const first = await createTerminal(createdIds)

  const firstState = await waitFor(
    `(async () => {
      const state = await window.bridge.invoke('terminal:getState', ${JSON.stringify(first.sessionId)})
      return state.terminals.find((terminal) => terminal.id === ${first.id}) ?? null
    })()`,
    'first terminal state'
  )
  assert.match(firstState.title, /^(PowerShell|CMD|Bash|Zsh)$/)
  assert.ok(firstState.cwd, 'terminal cwd should not be empty')
  assert.equal(
    await evaluate(
      `document.querySelector('.larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent`
    ),
    firstState.title
  )

  const marker = `LARIFY_TERMINAL_CDP_${Date.now()}`
  await evaluate(
    `window.bridge.invoke('terminal:write', ${JSON.stringify(first.sessionId)}, ${first.id}, ${JSON.stringify(`Write-Output "${marker}"\r`)})`
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('terminal:snapshot', ${JSON.stringify(first.sessionId)}, ${first.id}))?.data.includes('${marker}'))()`,
    'terminal keyboard output'
  )

  const second = await createTerminal(createdIds)
  const createdTabs = await evaluate(`(() =>
    ${JSON.stringify([first.id, second.id])}.map((resourceId) => {
      const view = document.querySelector(
        '[data-workbench-view="terminal"][data-resource-id="' + resourceId + '"]'
      )
      const id = view?.getAttribute('data-view-id')
      const tab = id
        ? document.querySelector('.larify-workbench-tab[data-tab-id="' + id + '"]')
        : null
      return {
        id,
        resourceId,
        title: tab?.querySelector('.larify-workbench-tab-title')?.textContent ?? null
      }
    })
  )()`)
  assert.deepEqual(
    createdTabs.map(({ resourceId, title }) => ({ resourceId, title })),
    [first, second].map(({ id }) => ({ resourceId: id, title: 'PowerShell' }))
  )

  await evaluate(`document
    .querySelector('.larify-workbench-tab[data-tab-id="${createdTabs[0].id}"] .larify-workbench-tab-trigger')
    ?.click()`)
  await waitFor(
    `document.querySelector('.larify-workbench-tab[data-tab-id="${createdTabs[0].id}"] [role="tab"]')?.getAttribute('aria-selected') === 'true'`,
    'first terminal tab selection'
  )

  await evaluate(
    `document.querySelector('.larify-workbench-tab[data-tab-id="${createdTabs[1].id}"] .larify-workbench-tab-close')?.click()`
  )
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${second.id}))()`,
    'terminal resource close'
  )
  createdIds.splice(createdIds.indexOf(second.id), 1)

  console.log(
    JSON.stringify(
      {
        cwd: firstState.cwd,
        marker,
        resourcesCreated: 2,
        title: firstState.title
      },
      null,
      2
    )
  )
} finally {
  for (const id of createdIds) {
    await evaluate(`window.bridge.invoke('resource:close', ${id})`)
  }
  const leaked = await evaluate(`window.bridge.invoke('resource:list')`)
  assert.deepEqual(leaked, initialResources, 'CDP test should restore initial resources')
  socket.close()
}
