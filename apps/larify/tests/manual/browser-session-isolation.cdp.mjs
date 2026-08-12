/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const { close, evaluate, send } = await connectLarifyCdp()
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const created = []

try {
  await send('Page.bringToFront')
  const sessions = await evaluate(`window.bridge.invoke('session:list', '', 0, 20)`)
  const resources = await evaluate(`window.bridge.invoke('resource:list', {})`)
  const visibleTitles = await evaluate(
    `[...document.body.querySelectorAll('*')]
      .filter((element) => element.children.length === 0)
      .map((element) => element.textContent?.trim())`
  )
  const occupiedSessions = new Set(
    resources.filter(({ type }) => type === 'browser').map(({ sessionId }) => sessionId)
  )
  const visibleSessions = sessions.filter(
    ({ id, title }) => visibleTitles.includes(title) && !occupiedSessions.has(id)
  )
  if (visibleSessions.length < 2) throw new Error('At least two visible sessions are required')
  const [first, second] = visibleSessions
  for (const [session, url] of [
    [first, 'https://example.com/'],
    [second, 'https://www.iana.org/help/example-domains']
  ]) {
    const id = await evaluate(
      `window.bridge.invoke('resource:create', 'browser', ${JSON.stringify(session.id)}, ` +
        `${JSON.stringify({ url })})`
    )
    created.push({ id, sessionId: session.id, title: session.title, url })
  }
  await wait(3000)

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.getAttribute('aria-label') === '显示工作台')
    button?.click()
    return Boolean(button)
  })()`)
  await wait(1000)

  const observations = []
  for (const item of created) {
    const selected = await evaluate(`(() => {
      const title = ${JSON.stringify(item.title)}
      const element = [...document.body.querySelectorAll('*')]
        .find((candidate) => candidate.children.length === 0 && candidate.textContent?.trim() === title)
      if (!(element instanceof HTMLElement)) return false
      element.click()
      return true
    })()`)
    if (!selected) throw new Error(`Could not select session: ${item.title}`)
    await wait(1500)
    observations.push(
      await evaluate(`(async () => ({
        sessionId: ${JSON.stringify(item.sessionId)},
        resources: await window.bridge.invoke('resource:list', { sessionId: ${JSON.stringify(item.sessionId)} }),
        browserState: await window.bridge.invoke(
          'browser:getState',
          ${JSON.stringify(item.sessionId)},
          ${item.id}
        ),
        activeSession: document.querySelector('button[aria-current="page"]')?.textContent?.trim() ?? null,
        workbenchTabs: [...document.querySelectorAll('.larify-workbench-tab-trigger')]
          .map((tab) => ({ text: tab.textContent?.trim(), state: tab.getAttribute('data-state') }))
      }))()`)
    )
  }

  const results = observations.map((observation, index) => {
    const own = created[index]
    const other = created[1 - index]
    const canonicalAddress = (value) => value?.replace(/^https?:\/\//, '').replace(/\/$/, '')
    return {
      sessionId: own.sessionId,
      ownsOnlyItsBrowserResource:
        observation.resources.some(({ id }) => id === own.id) &&
        observation.resources.every(({ id }) => id !== other.id),
      showsOwnAddress:
        canonicalAddress(observation.browserState?.url) === canonicalAddress(own.url),
      hidesOtherAddress: observation.browserState?.url !== other.url,
      address: observation.browserState?.url ?? null,
      activeSession: observation.activeSession,
      workbenchTabs: observation.workbenchTabs,
      resources: observation.resources
    }
  })
  console.log(JSON.stringify({ created, results }, null, 2))
  if (
    results.some(
      (result) =>
        !result.ownsOnlyItsBrowserResource || !result.showsOwnAddress || !result.hidesOtherAddress
    )
  ) {
    process.exitCode = 1
  }
} finally {
  for (const { id } of created)
    await evaluate(`window.bridge.invoke('resource:close', ${id})`).catch(() => {})
  close()
}
