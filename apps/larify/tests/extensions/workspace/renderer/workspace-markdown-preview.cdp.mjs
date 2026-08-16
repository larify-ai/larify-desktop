/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const fixtureName = '__markdown-preview-cdp__'
const fixtureRoot = join(homedir(), '.larify', 'workspace', fixtureName)

await mkdir(fixtureRoot, { recursive: true })
await Promise.all([
  writeFile(
    join(fixtureRoot, '01-basic.md'),
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

[Basic fixture](./01-basic.md)
`
  ),
  writeFile(
    join(fixtureRoot, 'fixture.html'),
    '<!doctype html><title>Larify Markdown CDP Fixture</title><h1>HTML fixture</h1>'
  )
])

const app = await connectLarifyCdp()

const click = (selector) =>
  app.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    element?.click()
    return Boolean(element)
  })()`)

const clickTreeItem = (name) =>
  app.evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('[role="treeitem"]')).find(
      (element) => element.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(name)}
    )
    item?.querySelector('.rc-tree-node-content-wrapper')?.click()
    return Boolean(item)
  })()`)

try {
  await app.send('Page.reload', { ignoreCache: true })
  await wait(1500)
  await click('button[aria-label="显示工作台"]')
  await wait(300)
  assert.equal(
    await app.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (element) => element.textContent?.trim() === '文件'
      )
      button?.click()
      return Boolean(button)
    })()`),
    true,
    'workspace renderer should be available'
  )
  await wait(800)

  assert.equal(await clickTreeItem(fixtureName), true, 'CDP fixture folder is missing')
  await wait(300)
  assert.equal(await clickTreeItem('02-rich-content.md'), true, 'rich Markdown fixture is missing')
  await wait(2000)

  const preview = await app.evaluate(`(() => {
    const element = document.querySelector('.workspace-markdown-preview')
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
  assert.equal(preview.hasErrorOverlay, false)

  assert.equal(await click('button[aria-label="查看源码"]'), true)
  await wait(500)
  assert.deepEqual(
    await app.evaluate(`({
      action: document.querySelector('.larify-workbench-tab-actions button')?.getAttribute('aria-label'),
      monaco: Boolean(document.querySelector('.monaco-editor')),
      preview: Boolean(document.querySelector('.workspace-markdown-preview'))
    })`),
    { action: '阅读预览', monaco: true, preview: false }
  )

  assert.equal(await click('button[aria-label="阅读预览"]'), true)
  await wait(500)
  assert.equal(
    await app.evaluate(`Boolean(document.querySelector('.workspace-markdown-preview'))`),
    true
  )

  assert.equal(
    await app.evaluate(`(() => {
      const link = Array.from(document.querySelectorAll('.workspace-markdown-preview a')).find(
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
        document.querySelector('.workspace-markdown-preview')?.innerText ?? ''
      )
    })`),
    { activeTab: '01-basic.md', hasFrontmatter: false }
  )

  assert.equal(await clickTreeItem('fixture.html'), true, 'HTML fixture is missing')
  await wait(700)
  assert.deepEqual(
    await app.evaluate(`({
      activeTab: Array.from(document.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      )?.textContent?.trim(),
      action: document.querySelector('.larify-workbench-tab-actions button')?.getAttribute('aria-label'),
      monaco: Boolean(document.querySelector('.monaco-editor'))
    })`),
    { activeTab: 'fixture.html', action: '在内置浏览器中打开', monaco: true }
  )

  assert.equal(await click('button[aria-label="在内置浏览器中打开"]'), true)
  await wait(900)
  assert.deepEqual(
    await app.evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => ({
      text: tab.textContent?.trim(),
      selected: tab.getAttribute('aria-selected') === 'true'
    }))`),
    [
      { text: 'fixture.html', selected: false },
      { text: 'Larify Markdown CDP Fixture', selected: true }
    ]
  )

  console.log('workspace Markdown preview CDP regression passed')
} finally {
  app.close()
  await rm(fixtureRoot, { recursive: true, force: true })
}
