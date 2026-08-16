/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const cdp = await connectLarifyCdp()
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (expression, label, timeout = 8_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await cdp.evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const created = []
try {
  const sessionId = await waitFor(
    `document.querySelector('[data-workbench-session][data-active]')?.dataset.workbenchSession`,
    'active workbench session'
  )
  for (let index = 0; index < 2; index += 1) {
    created.push(
      await cdp.evaluate(
        `window.bridge.invoke('resource:create', 'browser', ${JSON.stringify(sessionId)}, {})`
      )
    )
  }

  for (const resourceId of created) {
    await waitFor(
      `Boolean(document.querySelector('[data-workbench-view="browser"][data-resource-id="${resourceId}"]'))`,
      `browser view ${resourceId}`
    )
  }

  for (const resourceId of created) {
    assert.equal(
      await cdp.evaluate(
        `document.querySelector('[data-resource-id="${resourceId}"]')?.classList.contains('hidden')`
      ),
      true
    )
  }

  await cdp.evaluate(`window.bridge.invoke('resource:close', ${created[0]})`)
  await waitFor(
    `!document.querySelector('[data-resource-id="${created[0]}"]')`,
    'closed browser unmounted'
  )
  created.shift()
  assert.equal(
    await cdp.evaluate(`Boolean(document.querySelector('[data-resource-id="${created[0]}"]'))`),
    true
  )

  console.log(JSON.stringify({ mounted: 2, inactiveMounted: true, unmountedOnClose: true }))
} finally {
  for (const resourceId of created) {
    await cdp.evaluate(`window.bridge.invoke('resource:close', ${resourceId})`)
  }
  cdp.close()
}
