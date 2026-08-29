/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const fixtureRoot = join(
  homedir(),
  '.larify',
  'workspace',
  `__message-link-cdp-${process.pid}-${Date.now()}__`
)
const port = process.env.LARIFY_CDP_PORT ?? '9222'
const fixtureFile = join(fixtureRoot, 'workspace-link.ts')
const reusedUrl = `http://127.0.0.1:${port}/json/version`
const differentUrl = `http://127.0.0.1:${port}/json/list`

await mkdir(fixtureRoot, { recursive: true })
await writeFile(fixtureFile, 'export const linked = true\n')

const app = await connectLarifyCdp(port)
let browserFixture

const targets = () =>
  fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())

const clickLink = (label) =>
  app.evaluate(`(() => {
    const link = Array.from(document.querySelectorAll('#message-link-cdp-root .larify-message-link'))
      .find((element) => element.textContent?.includes(${JSON.stringify(label)}))
    link?.click()
    return Boolean(link)
  })()`)

const visibleTextIncludes = (text) =>
  app.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)

async function waitFor(expression, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await app.evaluate(expression)) return
    await wait(100)
  }
  const diagnostics = await app.evaluate(`(() => ({
    body: document.body.innerText.slice(-2000),
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((item) => item.textContent),
    trees: Array.from(document.querySelectorAll('.workspace-tree')).map((tree) => ({
      titles: Array.from(tree.querySelectorAll('[title]')).map((item) => item.getAttribute('title')),
      selected: Array.from(tree.querySelectorAll('.rc-tree-node-selected [title]')).map(
        (item) => item.getAttribute('title')
      ),
      expanded: Array.from(tree.querySelectorAll('[role="treeitem"][aria-expanded="true"] [title]')).map(
        (item) => item.getAttribute('title')
      )
    }))
  }))()`)
  assert.fail(`${message}: ${JSON.stringify(diagnostics)}`)
}

try {
  await app.send('Page.reload', { ignoreCache: true })
  await wait(1200)
  await app.evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await wait(300)
  await app.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === '文件'
    )
    button?.click()
    return Boolean(button)
  })()`)
  await wait(800)

  browserFixture = await app.evaluate(`(async () => {
    const resources = await window.bridge.invoke('resource:list')
    const sessionId = resources.findLast(({ type }) => type === 'workspace')?.sessionId
    if (!sessionId) throw new Error('active session is unavailable')
    const initial = await window.bridge.invoke('resource:list', { sessionId, type: 'browser' })
    const resourceId = await window.bridge.invoke('resource:create', 'browser', sessionId, {
      url: ${JSON.stringify(reusedUrl)}
    })
    return { initialIds: initial.map(({ id }) => id), resourceId, sessionId }
  })()`)
  await waitFor(
    `(async () => (await window.bridge.invoke(
      'browser:getState',
      ${JSON.stringify(browserFixture.sessionId)},
      ${browserFixture.resourceId}
    ))?.url === ${JSON.stringify(reusedUrl)})()`,
    'agent-created browser fixture should finish opening'
  )

  const mounted = await app.evaluate(`(async () => {
    const [react, reactDom, reactDomClient, { MessageMarkdown }, messageLinks] =
      await Promise.all([
        import('/@id/react'),
        import('/@id/react-dom'),
        import('/@id/react-dom/client'),
        import('/src/app/interaction/assistant/message-parts/message-markdown.tsx'),
        import('/src/app/interaction/assistant/message-links.ts')
      ])
    const { createMessageLinkHandler, MessageLinkContextProvider } = messageLinks
    const createElement = react.createElement ?? react.default?.createElement
    const flushSync = reactDom.flushSync ?? reactDom.default?.flushSync
    const createRoot = reactDomClient.createRoot ?? reactDomClient.default?.createRoot
    const host = document.createElement('div')
    host.id = 'message-link-cdp-root'
    host.style.display = 'none'
    document.body.append(host)
    const resources = await window.bridge.invoke('resource:list')
    const sessionId = resources.findLast(({ type }) => type === 'workspace')?.sessionId
    if (!sessionId) throw new Error('active session is unavailable')
    const handler = createMessageLinkHandler('', sessionId)
    const root = createRoot(host)
    const markdown = [
      '[fixture-directory](' + ${JSON.stringify(fixtureRoot)} + ')',
      '[workspace-link.ts](' + ${JSON.stringify(fixtureFile)} + ')',
      '[reused-browser-url](' + ${JSON.stringify(reusedUrl)} + ')',
      '[different-browser-url](' + ${JSON.stringify(differentUrl)} + ')'
    ].join('\\n\\n')
    flushSync(() => root.render(
      createElement(MessageLinkContextProvider, { value: handler },
        createElement(MessageMarkdown, { isAnimating: false }, markdown)
      )
    ))
    window.__messageLinkCdpCleanup = () => {
      handler.dispose()
      root.unmount()
      host.remove()
      delete window.__messageLinkCdpCleanup
    }
    return host.querySelectorAll('.larify-message-link').length
  })()`)
  assert.equal(mounted, 4, 'the real Markdown renderer should create four message links')

  const browserCount = () =>
    app.evaluate(`window.bridge.invoke('resource:list', {
      sessionId: ${JSON.stringify(browserFixture.sessionId)},
      type: 'browser'
    }).then((resources) => resources.length)`)
  const countWithAgentTab = await browserCount()
  assert.equal(await clickLink('reused-browser-url'), true)
  await waitFor(
    `document.querySelector('[data-workbench-view="browser"][data-resource-id="${browserFixture.resourceId}"]')
      ?.getAttribute('aria-hidden') === 'false'`,
    'the agent-created browser tab should be selected'
  )
  assert.equal(await browserCount(), countWithAgentTab, 'same URL should reuse the agent tab')

  assert.equal(await clickLink('reused-browser-url'), true)
  await wait(300)
  assert.equal(await browserCount(), countWithAgentTab, 'repeated clicks should not create tabs')

  assert.equal(await clickLink('different-browser-url'), true)
  await waitFor(
    `(async () => (await window.bridge.invoke('resource:list', {
      sessionId: ${JSON.stringify(browserFixture.sessionId)},
      type: 'browser'
    })).length === ${countWithAgentTab + 1})()`,
    'a different URL should create a browser tab'
  )

  assert.equal(await clickLink('fixture-directory'), true)
  await waitFor(
    `(() => {
      const targetTitle = Array.from(
        document.querySelectorAll('.workspace-tree [draggable="true"][title]')
      ).find(
        (item) => item.getAttribute('title') === ${JSON.stringify(fixtureRoot)} &&
          item.closest('.rc-tree-node-selected')
      )
      const selected = targetTitle?.closest('.rc-tree-node-selected')
      const targetItem = targetTitle?.closest('[role="treeitem"]')
      const tree = targetTitle?.closest('.workspace-tree')
      const rootTitle = tree
        ?.querySelector('[role="treeitem"] [draggable="true"][title]')
        ?.getAttribute('title')
      const fileVisible = Array.from(
        tree?.querySelectorAll('[draggable="true"][title]') ?? []
      ).some(
        (item) => item.getAttribute('title') === ${JSON.stringify(fixtureFile)}
      )
      return Boolean(
        selected && targetItem?.getAttribute('aria-expanded') === 'true' &&
        rootTitle === ${JSON.stringify(fixtureRoot)} && fileVisible
      )
    })()`,
    'directory navigation should use the target as root, expand it, select its exact path, and show its child file'
  )
  assert.equal(
    await visibleTextIncludes('EISDIR: illegal operation on a directory, read'),
    false,
    'a directory link must not be sent to the file preview'
  )

  assert.equal(await clickLink('workspace-link.ts'), true)
  await waitFor(
    `Array.from(document.querySelectorAll('[role="tab"]')).some(
      (tab) => tab.textContent?.includes('workspace-link.ts')
    )`,
    'workspace-link.ts should open as a workspace tab'
  )
  assert.equal(
    (await targets()).some(({ url }) => url.startsWith('file:')),
    false,
    'file links must not create a file:// Chromium target'
  )
  console.log('assistant message-link CDP regression passed')
} finally {
  await app.evaluate(`window.__messageLinkCdpCleanup?.()`).catch(() => undefined)
  await app
    .evaluate(
      `(() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(
        (element) => element.textContent?.includes('workspace-link.ts')
      )
      tab?.closest('.larify-workbench-tab')
        ?.querySelector('.larify-workbench-tab-close')?.click()
    })()`
    )
    .catch(() => undefined)
  await wait(500)
  if (typeof browserFixture !== 'undefined') {
    const resources = await app
      .evaluate(`window.bridge.invoke('resource:list', {
        sessionId: ${JSON.stringify(browserFixture.sessionId)},
        type: 'browser'
      })`)
      .catch(() => [])
    for (const resource of resources) {
      if (!browserFixture.initialIds.includes(resource.id)) {
        await app
          .evaluate(`window.bridge.invoke('resource:close', ${resource.id})`)
          .catch(() => undefined)
      }
    }
  }
  app.close()
  await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
}
