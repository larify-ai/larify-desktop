/* 深挖：打开含 46KB final text 的完成消息（dbb6712d 12789 425KB）
   测完成态渲染成本：rAF 帧间隔 + longtask。
   重点观察：打开会话首屏/滚动到底时是否出现 300ms+ 长任务。 */
import { connectLarifyCdp } from './cdp-client.mjs'

const SESSION_ID = 'dbb6712d-f713-463f-bfb2-55f64d813767'
let cdp = await connectLarifyCdp()
const evaluate = (e, timeout = 15000) => cdp.evaluate(e, timeout)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expr, label, timeout = 90000) => {
  const s = Date.now()
  while (Date.now() - s < timeout) {
    const v = await evaluate(expr)
    if (v) return v
    await wait(150)
  }
  throw new Error('timeout ' + label)
}

const START_PROBE = `(() => {
  window.__p3?.stop?.()
  const p = { frames: [], longTasks: [], running: true, last: performance.now(), stopF: null }
  const frame = (now) => { p.frames.push(now - p.last); p.last = now; if (p.running) requestAnimationFrame(frame) }
  p.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) p.longTasks.push({ d: e.duration, t: e.startTime }) })
  try { p.observer.observe({ type: 'longtask' }) } catch {}
  p.stopF = () => { p.running = false; p.observer.disconnect() }
  window.__p3 = p
  requestAnimationFrame(frame)
  return true
})()`

const STOP_PROBE = `(() => {
  const p = window.__p3
  if (p?.stopF) p.stopF()
  if (!p) return null
  const gaps = p.frames.toSorted((a, b) => a - b)
  const pct = (f) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * f))] ?? 0
  const lt = p.longTasks.toSorted((a, b) => b.d - a.d)
  return {
    frames: p.frames.length,
    avg: +(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(1),
    p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), max: +Math.max(0, ...gaps).toFixed(0),
    longTasks: p.longTasks.length,
    topLongTasks: lt.slice(0, 12).map((l) => ({ ms: Math.round(l.d), t: Math.round(l.t) })),
    gt100: p.longTasks.filter((l) => l.d > 100).length,
    gt300: p.longTasks.filter((l) => l.d > 300).length
  }
})()`

try {
  await cdp.send('Page.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait(1500)
  cdp.close()
  cdp = await connectLarifyCdp()
  await waitFor(`document.querySelectorAll('[data-session-id]').length > 0`, 'sidebar', 60000)
  for (let k = 0; k < 3; k++) {
    await evaluate(
      `([...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim().startsWith('更多')).forEach(b=>b.click()))`
    )
    await wait(600)
  }
  await waitFor(`Boolean(document.querySelector('button[data-session-id="${SESSION_ID}"]'))`, 'target', 30000)
  await evaluate(START_PROBE)
  await evaluate(`document.querySelector('button[data-session-id="${SESSION_ID}"]').click()`)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages', 60000)
  await wait(4000)
  await evaluate(
    `(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v) v.scrollTop = v.scrollHeight })()`
  )
  await wait(4000)
  await evaluate(
    `(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v) v.scrollTop = 0 })()`
  )
  await wait(3000)
  await evaluate(
    `(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v) v.scrollTop = v.scrollHeight })()`
  )
  await wait(3000)

  const probe = await evaluate(STOP_PROBE)
  const metrics = await evaluate(`({
    msgCount: document.querySelectorAll('[data-message-index]').length,
    lastMsgNodes: (() => { const m=[...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index'))); return m[0]?m[0].querySelectorAll('*').length:0 })(),
    markdownEls: document.querySelectorAll('[data-streamdown], [data-markdown]').length,
    codeBlocks: document.querySelectorAll('pre, code').length,
    finalTextLen: (() => { const m=[...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index'))); return m[0]?(m[0].textContent||'').length:0 })()
  })`)
  console.log('>>> OPEN_PROBE:', JSON.stringify(probe, null, 2))
  console.log('>>> METRICS:', JSON.stringify(metrics, null, 2))
} catch (e) {
  console.error('ERR', e.message)
  console.error(e.stack)
} finally {
  cdp.close()
}
