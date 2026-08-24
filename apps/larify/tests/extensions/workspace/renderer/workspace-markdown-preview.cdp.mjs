/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const activeWorkspaceSelector =
  '[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]'
const fixtureName = '__markdown-preview-cdp__'
const workspaceRoot = join(homedir(), '.larify', 'workspace')
const fixtureRoot = join(workspaceRoot, fixtureName)

await mkdir(fixtureRoot, { recursive: true })
await Promise.all([
  writeFile(
    join(fixtureRoot, '01-basic.markdown'),
    `---
title: Hidden frontmatter
author: Larify
---
# Basic fixture
`
  ),
  writeFile(
    join(fixtureRoot, '02-rich-content.md'),
    `---
title: Hidden rich frontmatter
tags: [test]
---
# Rich fixture

| Feature | State |
| --- | --- |
| GFM | Ready |

\`\`\`ts
const ready = true
\`\`\`

Inline math: $E = mc^2$

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

[Basic fixture](./01-basic.markdown)

![Local fixture](./fixture.png)
`
  ),
  writeFile(
    join(fixtureRoot, 'fixture.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  ),
  writeFile(
    join(fixtureRoot, 'fixture.html'),
    '<!doctype html><title>Larify Markdown CDP Fixture</title><h1>HTML fixture</h1>'
  )
])

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
const waitFor = async (expression, label, timeout = 8_000) => {
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
    'CDP fixture folder'
  )
  assert.equal(await clickTreeItem(fixtureName), true, 'CDP fixture folder is missing')
  await wait(300)
  assert.equal(await clickTreeItem('02-rich-content.md'), true, 'rich Markdown fixture is missing')
  await waitFor(
    `Boolean(
      document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview') ||
      document.querySelector('button[aria-label="阅读预览"]')
    )`,
    'Markdown source or preview'
  )
  await click('button[aria-label="阅读预览"]')
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview'))`,
    'Markdown preview'
  )
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.ant-mermaid-graph svg, svg[id^="mermaid-"]'))`,
    'Mermaid preview'
  )
  await waitFor(
    `(() => {
      const image = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview img[alt="Local fixture"]')
      return image?.src.startsWith('blob:') && image.complete && image.naturalWidth > 0
    })()`,
    'local Markdown image'
  )

  const preview = await app.evaluate(`(() => {
    const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
    const element = workspace?.querySelector('.workspace-markdown-preview')
    const text = element?.innerText ?? ''
    return {
      activeTab: Array.from(document.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      )?.textContent?.trim(),
      actionLabels: Array.from(document.querySelectorAll('.larify-workbench-tab-actions button')).map(
        (button) => button.getAttribute('aria-label')
      ),
      hasPreview: Boolean(element),
      hasFrontmatter: /(?:^|\\n)(?:title|author|tags):/.test(text),
      headings: Array.from(element?.querySelectorAll('h1, h2') ?? []).map((heading) => heading.textContent),
      codeBlocks: element?.querySelectorAll('pre').length ?? 0,
      math: element?.querySelectorAll('.katex').length ?? 0,
      mermaid: element?.querySelectorAll('.ant-mermaid-graph svg, svg[id^="mermaid-"]').length ?? 0,
      localImage: (() => {
        const image = element?.querySelector('img[alt="Local fixture"]')
        return Boolean(image?.src.startsWith('blob:') && image.complete && image.naturalWidth > 0)
      })(),
      hasErrorOverlay: Boolean(document.querySelector('vite-error-overlay'))
    }
  })()`)
  assert.equal(preview.activeTab, '02-rich-content.md')
  assert.deepEqual(preview.actionLabels, ['查看源码', '隐藏目录树'])
  assert.equal(preview.hasPreview, true)
  assert.equal(preview.hasFrontmatter, false)
  assert.ok(preview.headings.includes('Rich fixture'))
  assert.ok(preview.codeBlocks > 0)
  assert.ok(preview.math > 0)
  assert.ok(preview.mermaid > 0)
  assert.equal(preview.localImage, true)
  assert.equal(preview.hasErrorOverlay, false)

  assert.equal(await click('button[aria-label="查看源码"]'), true)
  await wait(500)
  assert.deepEqual(
    await app.evaluate(`({
      action: document.querySelector('.larify-workbench-tab-actions button')?.getAttribute('aria-label'),
      monaco: Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.monaco-editor')),
      preview: Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview'))
    })`),
    { action: '阅读预览', monaco: true, preview: false }
  )

  assert.equal(await click('button[aria-label="阅读预览"]'), true)
  await wait(500)
  assert.equal(
    await app.evaluate(
      `Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview'))`
    ),
    true
  )

  assert.equal(
    await app.evaluate(`(() => {
      const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
      const link = Array.from(workspace?.querySelectorAll('.workspace-markdown-preview a') ?? []).find(
        (element) => element.textContent === 'Basic fixture'
      )
      link?.click()
      return Boolean(link)
    })()`),
    true,
    'relative Markdown link is missing'
  )
  await wait(700)
  assert.deepEqual(
    await app.evaluate(`({
      activeTab: Array.from(document.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      )?.textContent?.trim(),
      hasFrontmatter: /(?:^|\\n)(?:title|author|tags):/.test(
        document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview')?.innerText ?? ''
      )
    })`),
    { activeTab: '01-basic.markdown', hasFrontmatter: false }
  )

  assert.equal(await clickTreeItem('fixture.html'), true, 'HTML fixture is missing')
  await wait(700)
  assert.deepEqual(
    await app.evaluate(`({
      activeTab: Array.from(document.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      )?.textContent?.trim(),
      action: document.querySelector('.larify-workbench-tab-actions button')?.getAttribute('aria-label'),
      monaco: Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.monaco-editor'))
    })`),
    { activeTab: 'fixture.html', action: '在内置浏览器中打开', monaco: true }
  )

  assert.equal(await click('button[aria-label="在内置浏览器中打开"]'), true)
  await waitFor(
    `Array.from(document.querySelectorAll('[role="tab"]')).some(
      (tab) => tab.getAttribute('aria-selected') === 'true' && tab.textContent?.trim() === 'Larify Markdown CDP Fixture'
    )`,
    'HTML browser title'
  )
  assert.deepEqual(
    await app.evaluate(`({
      active: Array.from(document.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      )?.textContent?.trim(),
      workspace: Array.from(document.querySelectorAll('[role="tab"]')).some(
        (tab) => tab.textContent?.trim() === 'fixture.html' && tab.getAttribute('aria-selected') !== 'true'
      )
    })`),
    { active: 'Larify Markdown CDP Fixture', workspace: true }
  )

  console.log('workspace Markdown preview CDP regression passed')
} catch (error) {
  console.error(
    await app.evaluate(`(() => {
      const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
      return {
        actions: Array.from(document.querySelectorAll('.larify-workbench-tab-actions button')).map(
          (button) => button.getAttribute('aria-label')
        ),
        active: workspace?.getAttribute('data-active'),
        error: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(0, 500),
        runtimeErrors: ${JSON.stringify(runtimeErrors)},
        selected: workspace?.querySelector('.rc-tree-treenode-selected')?.textContent?.trim(),
        text: workspace?.innerText?.slice(0, 500),
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
