/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 回归：workspace 预览中外部 URL 链接点击应打开内置浏览器 tab。
// 背景：此前 markdown-preview 用 createMessageLinkHandler(cwd, '') 传空 sessionId，
// 导致 browser:openUrl 创建资源后 dispatch 的 workbench-select-resource 因 sessionId
// 不匹配被丢弃，浏览器 tab 静默失效。修复后透传真实 sessionId 统一到消息正文链路。
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const activeWorkspaceSelector =
  '[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]'
const externalUrl = 'https://example.com/external-link-test'
const fixtureName = '__markdown-external-url-cdp__'
const workspaceRoot = join(homedir(), '.larify', 'workspace')
const fixtureRoot = join(workspaceRoot, fixtureName)

await mkdir(fixtureRoot, { recursive: true })
await writeFile(
  join(fixtureRoot, '01-external.md'),
  `---
title: External URL regression
---
# External link

[External link](${externalUrl})
`
)

const app = await connectLarifyCdp()
const runtimeErrors = []
await app.send('Runtime.enable')
const unsubscribeRuntime = app.onEvent((message) => {
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(
      message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text
    )
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    runtimeErrors.push(
      message.params.args.map((argument) => argument.value ?? argument.description).join(' ')
    )
  }
})
const waitFor = async (expression, label, timeout = 10_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await app.evaluate(expression)) return
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const click = (selector) =>
  app.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    element?.click()
    return Boolean(element)
  })()`)

const clickTreeItem = (name) =>
  app.evaluate(`(() => {
    const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
    const item = Array.from(workspace?.querySelectorAll('[role="treeitem"]') ?? []).find(
      (element) => element.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(name)}
    )
    item?.querySelector('.rc-tree-node-content-wrapper')?.click()
    return Boolean(item)
  })()`)

let workspaceResourceId

try {
  await app.send('Page.reload', { ignoreCache: true })
  await waitFor(
    `Boolean(window.bridge && (
      document.querySelector('[data-workbench-session][data-active]') ||
      document.querySelector('button[data-session-id][aria-current="page"]')
    ))`,
    'renderer readiness'
  )
  await click('button[aria-label="显示工作台"]')
  await wait(300)
  const sessionId = await app.evaluate(
    `document.querySelector('[data-workbench-session][data-active]')?.getAttribute('data-workbench-session') ??
     document.querySelector('button[data-session-id][aria-current="page"]')?.getAttribute('data-session-id')`
  )
  assert.ok(sessionId, 'active session should be available')
  const resourceId = await app.evaluate(
    `window.bridge.invoke('resource:create', 'workspace', ${JSON.stringify(sessionId)}, { root: ${JSON.stringify(workspaceRoot)} })`
  )
  assert.ok(resourceId, 'workspace renderer should be available')
  workspaceResourceId = resourceId
  await waitFor(
    `Boolean(document.querySelector('[data-workbench-view="workspace"][data-resource-id="${resourceId}"]'))`,
    'workspace mount'
  )
  await app.evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
    detail: {
      rendererId: 'workspace',
      resourceId: ${JSON.stringify(resourceId)},
      sessionId: ${JSON.stringify(sessionId)}
    }
  }))`)
  await waitFor(
    `Boolean(document.querySelector('[data-workbench-view="workspace"][data-resource-id="${resourceId}"][data-active]'))`,
    'workspace activation'
  )
  await waitFor(
    `Array.from(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelectorAll('[role="treeitem"]') ?? []).some(
      (element) => element.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(fixtureName)}
    )`,
    'external fixture folder'
  )
  assert.equal(await clickTreeItem(fixtureName), true, 'external fixture folder is missing')
  await wait(300)
  assert.equal(await clickTreeItem('01-external.md'), true, 'external fixture is missing')
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview'))`,
    'Markdown preview'
  )
  await click('button[aria-label="阅读预览"]')
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview'))`,
    'Markdown preview after mode'
  )

  assert.equal(
    await app.evaluate(`(() => {
      const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
      const link = Array.from(workspace?.querySelectorAll('.workspace-markdown-preview a') ?? []).find(
        (element) => element.getAttribute('href') === ${JSON.stringify(externalUrl)}
      )
      link?.click()
      return Boolean(link)
    })()`),
    true,
    'external URL link is missing'
  )
  await waitFor(
    `Array.from(document.querySelectorAll('[role="tab"]')).some(
      (tab) => tab.getAttribute('aria-selected') === 'true' && tab.textContent?.trim() === ${JSON.stringify(externalUrl)}
    )`,
    'external URL browser tab'
  )
  assert.deepEqual(
    await app.evaluate(`({
      active: Array.from(document.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      )?.textContent?.trim(),
      browser: Array.from(document.querySelectorAll('[data-workbench-view="browser"]')).some(
        (view) => view.getAttribute('data-active') === 'true'
      )
    })`),
    { active: externalUrl, browser: true }
  )
  assert.equal(runtimeErrors.length, 0, `unexpected runtime errors: ${runtimeErrors.join('; ')}`)

  console.log('workspace Markdown external URL CDP regression passed')
} catch (error) {
  console.error(
    await app.evaluate(`(() => {
      const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
      return {
        error: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(0, 500),
        runtimeErrors: ${JSON.stringify(runtimeErrors)},
        tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => ({
          active: tab.getAttribute('aria-selected'),
          title: tab.textContent?.trim()
        })),
        views: Array.from(document.querySelectorAll('[data-workbench-view]')).map((view) => ({
          active: view.getAttribute('data-active'),
          id: view.getAttribute('data-resource-id'),
          type: view.getAttribute('data-workbench-view')
        }))
      }
    })()`)
  )
  throw error
} finally {
  if (workspaceResourceId) {
    await app
      .evaluate(`window.bridge.invoke('resource:close', ${JSON.stringify(workspaceResourceId)})`)
      .catch(() => undefined)
    await wait(300)
  }
  unsubscribeRuntime()
  app.close()
  await rm(fixtureRoot, { recursive: true, force: true })
}
