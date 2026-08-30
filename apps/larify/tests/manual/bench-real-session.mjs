/* 用真实目标会话 02a5241f 的巨型消息（pos=12585 164parts / pos=12563 284parts），
   实测「完整展开全部 tool-group」的真实 DOM 帧成本。
   reload -> 打开会话 -> 滚动到底(最后一条 pos=12585) -> 逐个展开 activity-group+tool-group -> rAF/longtask 测量 */
import { connectLarifyCdp } from './cdp-client.mjs'
const SESSION_ID = '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'
let cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expression, label, timeout = 90000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const v = await evaluate(expression)
    if (v) return v
    await wait(80)
  }
  throw new Error('timeout ' + label)
}

// 通用帧/LongTask 探针（复用 long-session-performance.cdp.mjs 范式）
const startProbe = () => evaluate(`(() => {
  window.__p?.observer?.disconnect()
  const p = { frames: [], last: performance.now(), longTasks: [], running: true }
  const frame = (now) => { p.frames.push(now - p.last); p.last = now; if (p.running) requestAnimationFrame(frame) }
  p.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) p.longTasks.push(e.duration) })
  p.observer.observe({ type: 'longtask' })
  window.__p = p
  requestAnimationFrame(frame)
})()`)
const stopProbe = () => evaluate(`(() => {
  const p = window.__p; p.running = false; p.observer.disconnect()
  const s = p.frames.toSorted((a, b) => a - b)
  const pct = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))] ?? 0
  return { frames: s.length, avgMs: (s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(2), p50Ms: pct(0.5).toFixed(2), p95Ms: pct(0.95).toFixed(2), maxMs: Math.max(0, ...s).toFixed(2), longTasks: p.longTasks.length, maxLongTaskMs: Math.max(0, ...p.longTasks).toFixed(2) }
})()`)

try {
  // 1. reload 刷新目录，确保侧边栏有目标会话
  await cdp.send('Page.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait(500)
  cdp.close()
  cdp = await connectLarifyCdp()
  await waitFor(
    `Boolean(document.querySelector('button[data-session-id="${SESSION_ID}"]'))`,
    'target session in sidebar',
    90000
  )

  // 2. 打开目标会话
  await evaluate(`document.querySelector('button[data-session-id="${SESSION_ID}"]')?.click()`)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages rendered')
  console.log('>>> session opened')
  await wait(3000)

  // 3. 滚动到消息底部（最后一条 pos=12585 巨型消息，需滚出视口）
  const scrolled = await evaluate(`(() => {
    const vp = document.querySelector('[data-message-scroll-viewport]')
    if (!vp) return { ok: false, why: 'no viewport' }
    vp.scrollTop = vp.scrollHeight
    return { ok: true, scrollHeight: vp.scrollHeight, scrollTop: vp.scrollTop }
  })()`)
  console.log('>>> scroll:', JSON.stringify(scrolled))
  await wait(1500)

  // 4. 列出当前视口里最底部消息的活动组（含 data-activity-kind、节点数、文本）
  const bottom = await evaluate(`(() => {
    const msgs = [...document.querySelectorAll('[data-message-index]')]
    return msgs.map((m, i) => {
      const groups = [...m.querySelectorAll('[data-activity-group]')]
      return {
        i, idx: m.getAttribute('data-message-index'),
        nodes: m.querySelectorAll('*').length,
        txt: (m.textContent || '').trim().slice(0, 40),
        groups: groups.map((g) => ({
          kind: g.getAttribute('data-activity-kind'),
          state: g.dataset.state ?? 'none',
          nodes: g.querySelectorAll('*').length,
          txt: (g.textContent || '').trim().slice(0, 60)
        }))
      }
    }).filter((x) => x.nodes > 0)
  })()`)
  console.log('>>> bottom messages:', JSON.stringify(bottom, null, 2))

  // 5. 取节点最多（最可能是巨型消息）的消息，展开其所有 activity-group + 内层 tool-group，测量真实 rAF 帧成本
  const target = await evaluate(`(() => {
    const msgs = [...document.querySelectorAll('[data-message-index]')]
    let big = null, bigNodes = 0
    for (const m of msgs) {
      const n = m.querySelectorAll('*').length
      if (n > bigNodes) { bigNodes = n; big = m }
    }
    if (!big) return null
    const groups = [...big.querySelectorAll('[data-activity-group][data-activity-kind="activity-group"]')]
    const t = { idx: big.getAttribute('data-message-index'), nodes: bigNodes, txt: (big.textContent||'').trim().slice(0,50), groupCount: groups.length, groupTexts: groups.map(g=>(g.textContent||'').trim().slice(0,50)) }
    // 记录
    window.__bench = { target: t }
    return t
  })()`)
  console.log('>>> target:', JSON.stringify(target))
  if (!target) { console.log('NO_TARGET'); process.exit(0) }

  await wait(500)

  // 6. 逐个展开 activity-group 的所有可展开 trigger（含内层 tool-group），并同步测帧
  // 先把所有 activity-group 展开（click trigger），再展开内层 tool-group
  const expandPlan = await evaluate(`(() => {
    const expandAll = (root) => {
      root.querySelectorAll('button[aria-expanded]').forEach((b) => {
        if (b.getAttribute('aria-expanded') === 'false') b.click()
      })
    }
    // 记录初始 DOM 规模
    const doc = document.querySelector('[data-message-scroll-viewport]')?.parentElement ?? document
    return { initialNodes: doc.querySelectorAll('*').length, initialHtmlLen: doc.innerHTML.length }
  })()`)
  console.log('>>> expand plan initial:', JSON.stringify(expandPlan))

  // --- 先展开所有嵌套 trigger 一次（activity-group+tool-group），然后测帧 ---
  await startProbe()
  await evaluate(`(() => {
    // 找到目标消息，点击其中所有 aria-expanded=false 的 trigger（递归两次以展开嵌套层）
    const hit = [...document.querySelectorAll('[data-message-index]')].find((m) => m.querySelectorAll('*').length > 500)
    if (!hit) return false
    const clickAll = (n) => n.querySelectorAll('button[aria-expanded="false"]').forEach((b)=>b.click())
    clickAll(hit) // 第一层 activity-group + 已渲染的 tool-group
    return true
  })()`)
  await wait(2000) // 让展开动画/DOM 稳定
  const phase1 = await stopProbe()
  console.log('>>> PHASE1 expand activity+tool-groups (rAF during 2s):', JSON.stringify(phase1))

  // 7. 再递归展开剩余未展开 tool-group 细节（可能多层），再测一次
  await startProbe()
  await evaluate(`(() => {
    let changed = false
    for (let i = 0; i < 3; i++) {
      const b = [...document.querySelectorAll('[data-message-index]')].find((m)=>m.querySelectorAll('*').length>500)
      if (!b) break
      const btns = b.querySelectorAll('button[aria-expanded="false"]')
      if (!btns.length) break
      btns.forEach((x)=>x.click()); changed = true
    }
    return changed
  })()`)
  await wait(2500)
  const phase2 = await stopProbe()
  console.log('>>> PHASE2 deep expand (rAF during 2.5s):', JSON.stringify(phase2))

  // 8. 展开完成后统计最终 DOM 规模 + 活动组/tool-group 数量
  const final = await evaluate(`(() => {
    const hit = [...document.querySelectorAll('[data-message-index]')].find((m) => m.querySelectorAll('*').length > 500)
    if (!hit) return null
    const allGroups = [...hit.querySelectorAll('[data-activity-group]')]
    return {
      nodes: hit.querySelectorAll('*').length,
      htmlLen: hit.innerHTML.length,
      activityGroups: allGroups.length,
      kinds: allGroups.reduce((acc, g) => { const k = g.getAttribute('data-activity-kind'); acc[k] = (acc[k]||0)+1; return acc }, {}),
      toolGroups: allGroups.filter((g)=>g.getAttribute('data-activity-kind')==='tool-group').length,
      visibleTextLen: (hit.textContent||'').length
    }
  })()`)
  console.log('>>> FINAL DOM after full expand:', JSON.stringify(final, null, 2))

  // 9. 测「折叠回默认」的成本对比（当前折叠态基线）
  console.log('>>> done')
} catch (e) {
  console.error('ERR', e.message); console.error(e.stack)
} finally { cdp.close() }
