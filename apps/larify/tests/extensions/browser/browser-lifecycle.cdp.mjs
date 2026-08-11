/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const listTargets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const targets = await listTargets()
const appTarget = targets.find(({ type, url }) => type === 'page' && url.startsWith('http://localhost:'))
if (!appTarget?.webSocketDebuggerUrl) throw new Error(`Larify page not found on port ${port}`)

const socket = new WebSocket(appTarget.webSocketDebuggerUrl)
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
const send = (method, params = {}) => new Promise((resolveCommand, reject) => {
  const commandId = ++id
  pending.set(commandId, { resolve: resolveCommand, reject })
  socket.send(JSON.stringify({ id: commandId, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description)
  return result.result.value
}
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
const waitFor = async (expression, label, timeout = 8_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const marker = Date.now()
const sessionA = `browser-lifecycle-a-${marker}`
const sessionB = `browser-lifecycle-b-${marker}`
const fixture = resolve('tests/extensions/browser/fixtures/interaction.html')
const beforeTargetIds = new Set(targets.map(({ id }) => id))
const created = []

try {
  const first = await evaluate(
    `window.bridge.invoke('resource:create', 'browser', ${JSON.stringify(sessionA)}, { url: ${JSON.stringify(fixture)} })`
  )
  created.push(first)
  const second = await evaluate(
    `window.bridge.invoke('resource:create', 'browser', ${JSON.stringify(sessionB)}, { url: ${JSON.stringify(fixture)} })`
  )
  created.push(second)

  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(sessionA)}, ${first}))?.title === 'Browser Interaction Test')()`,
    'session A browser'
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(sessionB)}, ${second}))?.title === 'Browser Interaction Test')()`,
    'session B browser'
  )

  assert.deepEqual(
    await evaluate(`window.bridge.invoke('resource:list', { sessionId: ${JSON.stringify(sessionA)} })`),
    [{ id: first, type: 'browser', sessionId: sessionA }]
  )
  assert.deepEqual(
    await evaluate(`window.bridge.invoke('resource:list', { sessionId: ${JSON.stringify(sessionB)} })`),
    [{ id: second, type: 'browser', sessionId: sessionB }]
  )

  await evaluate(
    `window.bridge.invoke('browser:setVisible', ${JSON.stringify(sessionA)}, ${first}, true)`
  )
  await evaluate(
    `window.bridge.invoke('browser:setVisible', ${JSON.stringify(sessionB)}, ${second}, true)`
  )
  assert.ok(await evaluate(
    `(async () => Boolean(await window.bridge.invoke('browser:getState', ${JSON.stringify(sessionA)}, ${first})))()`
  ))

  await evaluate(`window.bridge.invoke('resource:close', ${first})`)
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${first}))()`,
    'session A resource close'
  )
  created.splice(created.indexOf(first), 1)
  assert.ok(await evaluate(
    `(async () => Boolean(await window.bridge.invoke('browser:getState', ${JSON.stringify(sessionB)}, ${second})))()`
  ))

  await evaluate(`window.bridge.invoke('resource:close', ${second})`)
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${second}))()`,
    'session B resource close'
  )
  created.splice(created.indexOf(second), 1)
  await wait(200)
  const remainingTargets = await listTargets()
  const leakedTargets = remainingTargets.filter(
    ({ id, url }) => !beforeTargetIds.has(id) && url.includes('interaction.html')
  )
  assert.deepEqual(leakedTargets, [])

  console.log(JSON.stringify({ isolation: 'passed', cleanup: 'passed', sessions: 2 }))
} finally {
  for (const resourceId of created) await evaluate(`window.bridge.invoke('resource:close', ${resourceId})`)
  socket.close()
}
