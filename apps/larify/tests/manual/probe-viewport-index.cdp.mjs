// 在"代码审查与优化建议"会话上实测 updateViewportIndex 成本
import { connectLarifyCdp } from './cdp-client.mjs'

const cdp = await connectLarifyCdp()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const TARGET = process.env.PROBE_SESSION_ID ?? '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'

const openSession = async (id) => {
  const ok = await cdp.evaluate(`(() => {
    const b = document.querySelector('button[data-session-id="${id}"]')
    if (!b) return false
    b.click()
    return true
  })()`)
  if (!ok) return 0
  await wait(1500)
  return cdp.evaluate(`document.querySelectorAll('[data-message-index]').length`)
}

// 目标会话
let count = await openSession(TARGET)
console.log(`target session ${TARGET} → ${count} rendered messages`)

// 若目标会话消息太少，退回枚举所有会话取最多的
if (count < 5) {
  const ids = await cdp.evaluate(
    `[...document.querySelectorAll('button[data-session-id]')].map(b=>b.dataset.sessionId)`
  )
  let best = { id: TARGET, count }
  for (const id of ids) {
    const c = await openSession(id)
    console.log(`  ${id} → ${c}`)
    if (c > best.count) best = { id, count: c }
  }
  count = best.count
  console.log(`using ${best.id} (${count} messages)`)
  await openSession(best.id)
}

if (count === 0) { console.log('NO_RENDERED_MESSAGES'); cdp.close(); process.exit(0) }

const result = await cdp.evaluate(`(() => {
  const viewport = document.querySelector('[data-message-scroll-viewport]')
  if (!viewport) return { error: 'no viewport' }
  const measure = () => {
    const t0 = performance.now()
    const vb = viewport.getBoundingClientRect()
    const anchor = vb.top + 1
    let ci, cd = Number.POSITIVE_INFINITY
    for (const el of viewport.querySelectorAll('[data-message-index]')) {
      const i = Number(el.dataset.messageIndex)
      if (!Number.isSafeInteger(i)) continue
      const b = el.getBoundingClientRect()
      if (b.height <= 0) continue
      const d = anchor < b.top ? b.top - anchor : anchor > b.bottom ? anchor - b.bottom : 0
      if (d < cd) { cd = d; ci = i }
    }
    return performance.now() - t0
  }
  for (let i = 0; i < 15; i += 1) measure()
  const s = []
  for (let i = 0; i < 200; i += 1) s.push(measure())
  const t1 = performance.now()
  let n = 0
  for (let i = 0; i < 200; i += 1) n = viewport.querySelectorAll('[data-message-index]').length
  s.sort((a, b) => a - b)
  const avg = s.reduce((x, y) => x + y, 0) / s.length
  return {
    renderedMessageElements: n,
    domNodes: document.querySelectorAll('*').length,
    avgMs: avg, p50Ms: s[100], p95Ms: s[190], maxMs: s[s.length - 1],
    querySelectorOnlyMs: (performance.now() - t1) / 200,
    pctOf60fpsFrame: avg / 16.7 * 100
  }
})()`)
console.log('\n--- updateViewportIndex 成本 ---')
console.log(JSON.stringify(result, null, 2))

const scrollStats = await cdp.evaluate(`(async () => {
  const viewport = document.querySelector('[data-message-scroll-viewport]')
  const frames = [], longTasks = []
  let last = performance.now(), running = true
  const ob = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration) })
  ob.observe({ type: 'longtask' })
  const f = (now) => { frames.push(now - last); last = now; if (running) requestAnimationFrame(f) }
  requestAnimationFrame(f)
  viewport.scrollTop = viewport.scrollHeight
  await new Promise((r) => setTimeout(r, 400))
  for (let i = 0; i < 80; i += 1) {
    viewport.scrollTop -= 160
    await new Promise((r) => requestAnimationFrame(r))
  }
  running = false; ob.disconnect()
  const s = frames.slice().sort((a, b) => a - b)
  return {
    frames: s.length,
    p50FrameMs: s[Math.floor(s.length * 0.5)],
    p95FrameMs: s[Math.floor(s.length * 0.95)],
    maxFrameMs: s[s.length - 1],
    framesOver33ms: s.filter((v) => v > 33).length,
    longTasks: longTasks.length,
    maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0
  }
})()`)
console.log('\n--- 连续向上滚动 ---')
console.log(JSON.stringify(scrollStats, null, 2))
cdp.close()
