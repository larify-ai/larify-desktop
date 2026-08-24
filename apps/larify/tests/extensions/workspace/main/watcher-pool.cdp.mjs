/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const root = await mkdtemp(path.join(tmpdir(), 'larify-watcher-pool-'))
const child = path.join(root, 'child')
await mkdir(child)
const app = await connectLarifyCdp()
const created = []
let originalSessionId

async function events() {
  return app.evaluate('window.__watcherPoolCdpEvents ?? []')
}

async function waitForEvent(resourceId, changedPath, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = (await events()).some(
      (event) => event.resourceId === resourceId && event.changedPath === changedPath
    )
    if (found) return
    await wait(50)
  }
  assert.fail(
    `workspace change was not received: ${resourceId} ${changedPath}; events=${JSON.stringify(await events())}`
  )
}

try {
  const sessionId = await app.evaluate(
    "document.querySelector('[data-workbench-session][data-active]')?.dataset.workbenchSession"
  )
  assert.ok(sessionId, 'active session is unavailable')
  originalSessionId = sessionId
  await app.evaluate(
    `window.bridge.invoke('workspace:set-active-session', ${JSON.stringify(sessionId)})`
  )
  const before = await app.evaluate("window.bridge.invoke('resource:list')")
  await app.evaluate(`(() => {
    window.__watcherPoolCdpEvents = []
    window.__disposeWatcherPoolCdp = window.bridge.on(
      'workspace:change',
      (resourceId, directory, changedPath) => {
        window.__watcherPoolCdpEvents.push({ resourceId, directory, changedPath })
      }
    )
  })()`)

  created.push(
    await app.evaluate(
      `window.bridge.invoke('resource:create', 'workspace', ${JSON.stringify(sessionId)}, { root: ${JSON.stringify(root)} })`
    )
  )
  created.push(
    await app.evaluate(
      `window.bridge.invoke('resource:create', 'workspace', ${JSON.stringify(sessionId)}, { root: ${JSON.stringify(root)} })`
    )
  )
  await Promise.all(
    created.map((id) =>
      app.evaluate(`window.bridge.invoke('workspace:list', ${id}, ${JSON.stringify(root)})`)
    )
  )
  await app.evaluate(
    `window.bridge.invoke('workspace:list', ${created[0]}, ${JSON.stringify(child)})`
  )

  const firstFile = path.join(child, 'first.txt')
  await writeFile(firstFile, 'first')
  await waitForEvent(created[0], firstFile)
  assert.equal(
    (await events()).some(
      (event) => event.resourceId === created[1] && event.changedPath === firstFile
    ),
    false,
    "an unexpanded subscription received another subscription's nested change"
  )

  await app.evaluate(`window.bridge.invoke('resource:close', ${created.shift()})`)
  await app.evaluate('window.__watcherPoolCdpEvents = []')
  const unwatchedFile = path.join(child, 'unwatched.txt')
  await writeFile(unwatchedFile, 'unwatched')
  await wait(750)
  assert.equal(
    (await events()).some((event) => event.changedPath === unwatchedFile),
    false,
    'a directory remained watched after its only subscription closed'
  )

  await app.evaluate(
    `window.bridge.invoke('workspace:list', ${created[0]}, ${JSON.stringify(child)})`
  )
  const resumedFile = path.join(child, 'resumed.txt')
  await writeFile(resumedFile, 'resumed')
  await waitForEvent(created[0], resumedFile)

  const originalResource = created[0]
  const inactiveSessionId = `${sessionId}:watcher-pool-cdp`
  const inactiveResource = await app.evaluate(
    `window.bridge.invoke('resource:create', 'workspace', ${JSON.stringify(inactiveSessionId)}, { root: ${JSON.stringify(root)} })`
  )
  created.push(inactiveResource)
  await app.evaluate(
    `window.bridge.invoke('workspace:list', ${inactiveResource}, ${JSON.stringify(child)})`
  )
  await app.evaluate(
    `window.bridge.invoke('workspace:set-active-session', ${JSON.stringify(inactiveSessionId)})`
  )
  await app.evaluate('window.__watcherPoolCdpEvents = []')
  const switchedFile = path.join(child, 'switched.txt')
  await writeFile(switchedFile, 'switched')
  await waitForEvent(inactiveResource, switchedFile)
  assert.equal(
    (await events()).some(
      (event) => event.resourceId === originalResource && event.changedPath === switchedFile
    ),
    false,
    'the inactive session received a workspace change'
  )
  await app.evaluate(
    `window.bridge.invoke('workspace:set-active-session', ${JSON.stringify(sessionId)})`
  )

  await app.evaluate(`window.bridge.invoke('resource:close-many', ${JSON.stringify(created)})`)
  created.length = 0
  assert.deepEqual(await app.evaluate("window.bridge.invoke('resource:list')"), before)
  console.log(JSON.stringify({ isolated: true, resumed: true, unwatched: true }))
} finally {
  if (originalSessionId) {
    await app
      .evaluate(
        `window.bridge.invoke('workspace:set-active-session', ${JSON.stringify(originalSessionId)})`
      )
      .catch(() => undefined)
  }
  if (created.length > 0) {
    await app
      .evaluate(`window.bridge.invoke('resource:close-many', ${JSON.stringify(created)})`)
      .catch(() => undefined)
  }
  await app
    .evaluate('window.__disposeWatcherPoolCdp?.(); delete window.__disposeWatcherPoolCdp')
    .catch(() => undefined)
  app.close()
  await rm(root, { recursive: true, force: true })
}
