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

// Step 0: 点击每个 session，找到包含 .workspace-markdown-preview 的那个
const candidates = await run(`
  const btns = Array.from(document.querySelectorAll('button[data-session-id]'))
  const out = []
  for (const b of btns.slice(0, 10)) {
    b.click()
    await new Promise(r => setTimeout(r, 500))
    const has = document.querySelector('.workspace-markdown-preview') ? 'Y' : 'N'
    out.push({ id: b.dataset.sessionId, label: b.textContent?.trim().slice(0,30), hasPreview: has })
    if (has === 'Y') break
  }
  return { sessionsTried: out.length, results: out }
`, '0. 依次点击 session 找包含 workspace markdown preview 的')

await wait(400)

// Step 1: 看链接元素
const info = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  return {
    previewFound: !!preview,
    workspaceCount: document.querySelectorAll('[data-workbench-view="workspace"]').length,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
`, '1. 链接元素检查')

// Step 2: 点击
const click = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  const l = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
    .find(el => /workspace-view\\.tsx|tsx/i.test(el.textContent ?? ''))
  if (!l) return '__no_link__'
  l.click()
  return { tag: l.tagName, text: l.textContent?.trim().slice(0, 50) }
`, '2. 点击第一个含 tsx 的链接')

await wait(2500)

// Step 3: 结果
const post = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  const previews = Array.from(document.querySelectorAll('.workspace-markdown-preview, .monaco-editor, [class*="workspace-file-preview"]'))
  const heads = previews.map(p => p.textContent?.slice(0, 90) ?? '')
  const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim())
  return { workspaceCountAfter: count, tabTitles: tabs.slice(-6), previewHeadSample: heads.slice(0, 4) }
`, '3. 点击后结果（workspace 数 / 最近 tab 标题 / 预览内容）')

console.log('\n=== Runtime errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 500))
process.exit(0)
