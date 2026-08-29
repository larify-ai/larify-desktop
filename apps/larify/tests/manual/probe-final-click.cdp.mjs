/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const wait = (t) => new Promise(r => setTimeout(r, t))
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const errors = []
const unsub = app.onEvent(msg => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push('[EX] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('[ERR] ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '))
})

const run = async (expr, label) => {
    console.log('\n→ ' + label)
    const r = await app.evaluate(`Promise.resolve().then(() => { ${expr} })`)
    console.log('  =', typeof r === 'string' && r.length > 800 ? r.slice(0, 800) + '…' : JSON.stringify(r).slice(0, 800))
    return r
}

// Step 1. 刷新窗口让 HMR 重新加载
await app.send('Page.reload', { ignoreCache: true })
await wait(3500)

// Step 2. 找到当前 workspace 中"链接跳转测试.md"对应的 link，查看它是否是 button
const info = await run(`
  const ws = document.querySelector('[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]')
  const preview = ws?.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  const workspaceCount = document.querySelectorAll('[data-workbench-view="workspace"]').length
  return {
    found: !!preview,
    workspaceCount,
    linkCount: links.length,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 40), href: l.getAttribute('href') })),
  }
`, '1. 链接元素列表（刷新后）')

// Step 3. 点击
const clicked = await run(`
  const ws = document.querySelector('[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]')
  const preview = ws?.querySelector('.workspace-markdown-preview')
  const l = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
    .find(el => /workspace-view\\.tsx/.test(el.textContent ?? ''))
  if (!l) return '__not_found__'
  l.click()
  return { clickedTag: l.tagName, clickedText: l.textContent?.trim().slice(0,50) }
`, '2. 点击 workspace-view.tsx 链接')

await wait(1800)
const after = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  // 是否预览到了 tsx 文件（或 monaco / 代码视图）
  const previews = Array.from(document.querySelectorAll('.workspace-markdown-preview, .monaco-editor, .workspace-file-preview'))
  const texts = previews.map(p => p.textContent?.slice(0, 80) ?? '')
  // 或看目录树里是否已选择文件
  return {
    workspaceCountAfter: count,
    anyPreviewMatchesWorkspaceViewTsx: previews.some(p => /revealWorkspaceFile|workspaceNavigationEvent|workspace-view\\.tsx/i.test(p.textContent ?? '')),
    lastPreviewHead: texts.slice(-3),
  }
`, '3. 点击后 workspace count + 新文件预览内容')

console.log('\n=== Runtime errors ===')
for (const e of errors.slice(0, 10)) console.log(' ', e.slice(0, 600))
process.exit(0)
