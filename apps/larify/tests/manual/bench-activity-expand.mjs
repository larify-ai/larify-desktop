/* 实测「展开巨型 activity-group（含大量折叠 summary 行）」的真实 DOM commit/reconcile 帧成本。
   对比：折叠态 vs 展开态；并用 rAF gap + PerformanceObserver(longtask) 采样。 */
import { connectLarifyCdp } from './cdp-client.mjs'

const SESSION_ID = '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'
const cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expr, label, timeout = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const v = await evaluate(expr)
    if (v) return v
    await wait(50)
  }
  throw new Error('timeout: ' + label)
}

const startProbe = () =>
  evaluate(`(() => {
    window.__benchProbe?.observer?.disconnect()
    const p = { frames: [], last: performance.now(), longTasks: [], running: true }
    const frame = (now) => { p.frames.push(now - p.last); p.last = now; if (p.running) requestAnimationFrame(frame) }
    p.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) p.longTasks.push(e.duration) })
    p.observer.observe({ type: 'longtask' })
    window.__benchProbe = p
    requestAnimationFrame(frame)
  })()`)
const stopProbe = () =>
  evaluate(`(() => {
    const p = window.__benchProbe; p.running = false; p.observer.disconnect()
    const s = p.frames.toSorted((a,b)=>a-b)
    const q = (f) => s[Math.min(s.length-1, Math.floor(s.length*f))] ?? 0
    return { frames: s.length, avgMs: s.reduce((a,b)=>a+b,0)/Math.max(1,s.length), p95: q(0.95), p99: q(0.99), maxMs: Math.max(0,...s), over50: s.filter(v=>v>50).length, longTasks: p.longTasks.length, maxLongTask: Math.max(0,...p.longTasks) }
  })()`)

try {
  // 1) 打开会话
  await evaluate(`(() => { const b = document.querySelector('button[data-session-id="${SESSION_ID}"]'); if (b) b.click() })()`)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages')
  await wait(1500)

  // 找巨型消息的折叠 summary（"已完成 · 处理了 53秒" 等），统计所有 activity summary
  const stats = await evaluate(`(() => {
    const summaries = [...document.querySelectorAll('button[class*="group/summary"]')]
    return {
      count: summaries.length,
      texts: summaries.map((s) => (s.textContent||'').trim().slice(0, 50)),
      msgIndexes: summaries.map((s) => s.closest('[data-message-index]')?.dataset.messageIndex)
    }
  })()`)
  console.log('summaries:', JSON.stringify(stats, null, 2))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cdp.close()
}
