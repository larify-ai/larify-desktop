/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const fixtureName = '__browser-files-cdp__'
const fixtureRoot = join(homedir(), '.larify', 'workspace', fixtureName)
const createPdf = () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 35 >>\nstream\nBT /F1 16 Tf 20 100 Td (PDF) Tj ET\nendstream'
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  return `${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

await mkdir(fixtureRoot, { recursive: true })
await Promise.all([
  writeFile(
    join(fixtureRoot, 'preview.html'),
    '<!doctype html><title>HTML fixture</title><h1>HTML</h1>'
  ),
  writeFile(join(fixtureRoot, 'source.ts'), 'export const workspaceRegression = true\n'),
  writeFile(
    join(fixtureRoot, 'preview.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZf7l5sAAAAASUVORK5CYII=',
      'base64'
    )
  ),
  writeFile(join(fixtureRoot, 'preview.pdf'), createPdf())
])

const app = await connectLarifyCdp()
const evaluate = (expression) => app.evaluate(expression)
const waitFor = async (expression, label, timeout = 6_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  const diagnostic = await evaluate(`({
    inputs: Array.from(document.querySelectorAll('input')).map((input) => ({ placeholder: input.placeholder, value: input.value })),
    hosts: Array.from(document.querySelectorAll('[data-browser-webview-host]')).map((host) => ({ active: host.hasAttribute('data-active'), id: host.getAttribute('data-browser-webview-host') })),
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent?.trim())
  })`)
  throw new Error(`Timed out: ${label}: ${JSON.stringify(diagnostic)}`)
}
const clickTreeItem = (name) =>
  evaluate(`(() => {
  const item = Array.from(document.querySelectorAll('[role="treeitem"]')).find(
    (element) => element.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(name)}
  )
  item?.querySelector('.rc-tree-node-content-wrapper')?.click()
  return Boolean(item)
})()`)
const selectWorkspace = (tabId) =>
  evaluate(`(() => {
  const tab = document.querySelector(${JSON.stringify(`[data-tab-id="${tabId}"] [role="tab"]`)})
  tab?.click()
  return Boolean(tab)
})()`)
let workspaceTabId

try {
  await app.send('Page.reload', { ignoreCache: true })
  await wait(1_500)
  await evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await wait(300)
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '文件')?.click()`
  )
  await wait(800)
  await waitFor(
    `Array.from(document.querySelectorAll('[role="treeitem"]')).some(
    (element) => element.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(fixtureName)}
  )`,
    'fixture folder'
  )
  assert.equal(await clickTreeItem(fixtureName), true, 'fixture folder is missing')
  await wait(300)
  workspaceTabId = await evaluate(
    `document.querySelector('[role="tab"][data-state="active"]')?.closest('[data-tab-id]')?.getAttribute('data-tab-id')`
  )
  assert.ok(workspaceTabId, 'active workspace tab id is missing')

  assert.equal(await clickTreeItem('source.ts'), true, 'source.ts is missing')
  await waitFor(
    `Boolean(document.querySelector('.monaco-editor')) &&
      !document.querySelector('[data-browser-webview-host][data-active]')`,
    'TypeScript source preview'
  )

  assert.equal(await clickTreeItem('preview.html'), true, 'preview.html is missing')
  await waitFor(
    `Boolean(
    document.querySelector('.monaco-editor') &&
    document.querySelector('button[aria-label="在内置浏览器中打开"]')
  )`,
    'HTML source preview'
  )
  assert.equal(
    await evaluate(`Boolean(document.querySelector('[data-browser-webview-host][data-active]'))`),
    false,
    'HTML must not open a browser tab before the toolbar action'
  )
  await evaluate(`document.querySelector('button[aria-label="在内置浏览器中打开"]')?.click()`)

  for (const name of ['preview.html', 'preview.png', 'preview.pdf']) {
    if (name !== 'preview.html') assert.equal(await clickTreeItem(name), true, `${name} is missing`)
    assert.equal(await clickTreeItem(name), true, `${name} is missing`)
    const state = await waitFor(
      `(() => {
      const host = document.querySelector('[data-browser-webview-host][data-active]')
      const viewport = document.querySelector('[data-testid="browser-viewport"]')
      let url = ''
      try { url = host?.querySelector('webview')?.getURL?.() ?? '' } catch {}
      if (!url?.includes(${JSON.stringify(name)}) || !host || !viewport) return null
      const view = host.getBoundingClientRect()
      const target = viewport.getBoundingClientRect()
      return {
        edgeDelta: Math.max(
          Math.abs(view.left - target.left), Math.abs(view.top - target.top),
          Math.abs(view.right - target.right), Math.abs(view.bottom - target.bottom)
        ),
        url
      }
    })()`,
      `${name} browser tab`
    )
    assert.match(state.url, /^file:/, `${name} should use a file URL`)
    assert.ok(state.edgeDelta <= 1, `${name} browser viewport has a ${state.edgeDelta}px gap`)
    assert.equal(await selectWorkspace(workspaceTabId), true, 'workspace tab is missing')
    await wait(250)
  }

  console.log(
    'TypeScript/HTML source, HTML explicit browser action, image/PDF direct browser; edge gap <= 1px'
  )
} finally {
  if (workspaceTabId) {
    await evaluate(
      `document.querySelector(${JSON.stringify(`[data-tab-id="${workspaceTabId}"] .larify-workbench-tab-close`)})?.click()`
    ).catch(() => undefined)
    await wait(300)
  }
  app.close()
  await rm(fixtureRoot, { recursive: true, force: true })
}
