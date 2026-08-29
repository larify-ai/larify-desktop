/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const wait = (t) => new Promise(r => setTimeout(r, t))
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const errors = []
app.onEvent(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push('[EX] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('[ERR] ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '))
})

const run = async (expr, label) => {
  console.log('\n→ ' + label)
  const r = await app.evaluate(`Promise.resolve().then(() => { ${expr} })`)
  console.log('  =', JSON.stringify(r).slice(0, 900))
  return r
}

// Step 0: 找 session 按钮包含 "workspace"/"默认"/"markdown" 字样或直接逐个试（同步循环，每个点完同步检查）
await run(`
  const btns = Array.from(document.querySelectorAll('button[data-session-id]'))
  window.__CDP_FOUND_PREVIEW_SESSION_IDX = -1
  // 直接一次性点：先试第一个"默认空间/测试链接"相关的（session 名含默认或含 test/link/md/workspace）
  const firstGuessIdx = btns.findIndex(b => /默认|链接|测试|markdown|workspace|文档/i.test(b.textContent ?? ''))
  if (firstGuessIdx >= 0) { btns[firstGuessIdx].click(); window.__CDP_FOUND_PREVIEW_SESSION_IDX = firstGuessIdx }
  else if (btns[0]) { btns[0].click(); window.__CDP_FOUND_PREVIEW_SESSION_IDX = 0 }
  return {
    firstGuessIdx: window.__CDP_FOUND_PREVIEW_SESSION_IDX,
    sessionLabels: btns.slice(0,8).map(b => b.textContent?.trim().slice(0,30)),
  }
`, '0. 点第一个"默认/链接/测试"session')

await wait(1000)

// Step 1. 链接检查
const info = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  return {
    previewFound: !!preview,
    workspaceCount: document.querySelectorAll('[data-workbench-view="workspace"]').length,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
`, '1. 链接元素检查')

// Step 2. 点击
const click = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  const l = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
    .find(el => /workspace-view\\.tsx|tsx/i.test(el.textContent ?? ''))
  if (!l) return '__no_link__'
  l.click()
  return { tag: l.tagName, text: l.textContent?.trim().slice(0, 50) }
`, '2. 点击链接')

await wait(2500)

// Step 3. 结果
const post = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  const previews = Array.from(document.querySelectorAll('.workspace-markdown-preview, .monaco-editor, [class*="workspace-file-preview"]'))
  const heads = previews.map(p => p.textContent?.slice(0, 90) ?? '')
  const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim())
  return { workspaceCountAfter: count, tabTitles: tabs.slice(-8), previewHeadSample: heads.slice(0, 4) }
`, '3. 结果')

console.log('\n=== Runtime errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 500))
process.exit(0)
