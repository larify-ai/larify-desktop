/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 验证：工作区 Markdown 阅读预览的正文可选中（user-select:text），而目录树等导航 chrome 仍不可选中。
// 前置：应用以 --remote-debugging-port=9222 运行。
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const activeWorkspaceSelector =
  '[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]'
const fixtureName = '__md-select-probe__'
const workspaceRoot = join(homedir(), '.larify', 'workspace')
const fixtureRoot = join(workspaceRoot, fixtureName)

await mkdir(fixtureRoot, { recursive: true })
await writeFile(
  join(fixtureRoot, 'doc.md'),
  '# Selectable heading\n\nA selectable paragraph body.\n\n- item one\n- item two\n\n```ts\nconst selected = true\n```\n'
)

const app = await connectLarifyCdp()
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
    `Boolean(window.bridge && document.querySelector('[data-workbench-session][data-active]'))`,
    'renderer readiness'
  )
  const sessionId = await app.evaluate(
    `document.querySelector('[data-workbench-session][data-active]')?.getAttribute('data-workbench-session')`
  )
  assert.ok(sessionId, 'active session should be available')
  const resourceId = await app.evaluate(
    `window.bridge.invoke('resource:create', 'workspace', ${JSON.stringify(sessionId)}, { root: ${JSON.stringify(workspaceRoot)} })`
  )
  workspaceResourceId = resourceId
  await app.evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
    detail: {
      rendererId: 'workspace',
      resourceId: ${JSON.stringify(resourceId)},
      sessionId: ${JSON.stringify(sessionId)}
    }
  }))`)
  await waitFor(
    `Array.from(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelectorAll('[role="treeitem"]') ?? []).some(
      (element) => element.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(fixtureName)}
    )`,
    'probe folder'
  )
  assert.equal(await clickTreeItem(fixtureName), true, 'probe folder missing')
  await wait(300)
  assert.equal(await clickTreeItem('doc.md'), true, 'probe doc missing')
  // 若还是源码视图（按钮为「阅读预览」）则切换；已是预览视图则跳过。
  await click('button[aria-label="阅读预览"]')
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(activeWorkspaceSelector)})?.querySelector('.workspace-markdown-preview'))`,
    'Markdown preview'
  )
  await wait(800)

  // 用 Range 真实取词，模拟鼠标拖拽选中：如果 user-select:none，浏览器不会允许选中，
  // 但 getComputedStyle 才是判据本体。
  const result = await app.evaluate(`(() => {
    const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
    const preview = workspace.querySelector('.workspace-markdown-preview')
    const computed = (element) => getComputedStyle(element).userSelect
    const paragraph = preview.querySelector('p')
    const heading = preview.querySelector('h1')
    const listItem = preview.querySelector('li')
    const code = preview.querySelector('pre')

    // 模拟真实拖拽选词
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    const selectedText = selection.toString().trim()

    // 目录树 chrome
    const treeTitle = workspace.querySelector('.rc-tree-title')
    return {
      paragraph: computed(paragraph),
      heading: computed(heading),
      listItem: computed(listItem),
      code: computed(code),
      selectedText,
      tree: treeTitle ? computed(treeTitle) : null,
      copyEventAllowed: paragraph ? document.queryCommandSupported?.('copy') ?? null : null
    }
  })()`)

  console.log(JSON.stringify(result, null, 2))

  assert.equal(result.paragraph, 'text', 'preview paragraph should be selectable')
  assert.equal(result.heading, 'text', 'preview heading should be selectable')
  assert.equal(result.listItem, 'text', 'preview list item should be selectable')
  assert.equal(result.code, 'text', 'preview code block should be selectable')
  assert.ok(result.selectedText.length > 0, 'dragging should select real text')
  assert.equal(result.tree, 'none', 'tree chrome must remain unselectable')

  console.log('markdown preview selectable probe passed')
} catch (error) {
  console.error(
    await app.evaluate(`(() => {
      const workspace = document.querySelector(${JSON.stringify(activeWorkspaceSelector)})
      return {
        hasPreview: Boolean(workspace?.querySelector('.workspace-markdown-preview')),
        text: workspace?.innerText?.slice(0, 300)
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
  app.close()
  await rm(fixtureRoot, { recursive: true, force: true })
}
