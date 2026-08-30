/* 实时 baseline：af7afa96 会话现有一个正在 streaming 的巨型 assistant 消息(284KB+仍在增长)。
   打开该会话，用 rAF 探针 + DOM sampler 测 streaming 期间真实帧成本。
   目标：把「活跃 streaming 巨型消息」的帧间隔 + 最后一条 assistant 消息 DOM 节点数做相关性采集。 */
import { connectLarifyCdp } from './cdp-client.mjs'
const SESSION_ID = 'af7afa96-9018-45a1-92da-46d8d41f0eeb'
let cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expr, label, timeout = 90000) => {
  const s = Date.now()
  while (Date.now() - s < timeout) { const v = await evaluate(expr); if (v) return v; await wait(100) }
  throw new Error('timeout ' + label)
}

const startProbe = () => evaluate(`(() => {
  window.__p?.stop?.()
  const p = { frames: [], longTasks: [], running: true, stopF: null, last: performance.now() }
  const frame = (now) => {
    const gap = now - p.last
    p.frames.push({ gap, t: now, nodes: window.__lastMsgNodes ?? 0 })
    p.last = now
    if (p.running) requestAnimationFrame(frame)
  }
  p.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) p.longTasks.push({ d: e.duration, t: e.startTime }) })
  try { p.observer.observe({ type: 'longtask' }) } catch {}
  p.stopF = () => { p.running = false; p.observer.disconnect() }
  window.__p = p
  requestAnimationFrame(frame)
  return true
})()`)

const kickDomSampler = () => evaluate(`(() => {
  window.__domSampler?.stop?.()
  const s = { samples: [], running: true, stopF: null }
  const take = () => {
    if (!s.running) return
    const groups = [...document.querySelectorAll('[data-activity-group]')]
    const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
    let lastNodes = 0, openGroups = 0, lastG = 0, lastOpenG = 0
    if (msgs[0]) { lastNodes = msgs[0].querySelectorAll('*').length; lastG = msgs[0].querySelectorAll('[data-activity-group]').length; lastOpenG = msgs[0].querySelectorAll('[data-activity-group][data-state="open"]').length }
    openGroups = groups.filter(g => g.dataset.state === 'open').length
    const rec = { t: Math.round(performance.now()), lastNodes, groupCount: groups.length, openGroups, msgCount: msgs.length, lastG, lastOpenG }
    s.samples.push(rec)
    window.__lastMsgNodes = lastNodes
  }
  const iv = setInterval(take, 100)
  s.stopF = () => { clearInterval(iv); s.running = false }
  window.__domSampler = s
  take()
  return true
})()`)

const stopSampler = () => evaluate(`(() => { const s=window.__domSampler; if(s?.stopF) s.stopF(); return (s?.samples ?? []) })()`)
const stopProbe = () => evaluate(`(() => {
  const p = window.__p; if (p.stopF) p.stopF()
  const gaps = p.frames.map(f => f.gap).toSorted((a,b)=>a-b)
  const pct = (f) => gaps[Math.min(gaps.length-1, Math.floor(gaps.length*f))] ?? 0
  const maxGap = Math.max(0, ...gaps)
  const nodeBuckets = {}
  for (const f of p.frames) { const b = Math.floor(f.nodes / 200) * 200; nodeBuckets[b] = nodeBuckets[b] || []; nodeBuckets[b].push(f.gap) }
  const nodeStats = {}
  for (const [b, arr] of Object.entries(nodeBuckets)) {
    const s2 = arr.toSorted((a,b2)=>a-b2)
    const pctA = (f) => s2[Math.min(s2.length-1, Math.floor(s2.length*f))]
    nodeStats[+b] = { n: s2.length, avg: +(s2.reduce((a,c)=>a+c,0)/s2.length).toFixed(1), p95: +pctA(0.95).toFixed(1), max: +s2[s2.length-1].toFixed(1) }
  }
  return {
    frames: p.frames.length, avgMs: +(gaps.reduce((a,b2)=>a+b2,0)/Math.max(1,gaps.length)).toFixed(2),
    p50Ms: +pct(0.5).toFixed(2), p95Ms: +pct(0.95).toFixed(2), maxMs: +maxGap.toFixed(2),
    longTasks: p.longTasks.length, maxLongTaskMs: +(Math.max(0,...p.longTasks.map(l=>l.d))).toFixed(2), nodeVsGap: nodeStats
  }
})()`)

try {
  await cdp.send('Page.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait(600)
  cdp.close(); cdp = await connectLarifyCdp()
  await waitFor(`document.querySelectorAll('[data-session-id]').length > 0`, 'sidebar', 60000)
  for (let k = 0; k < 3; k++) {
    await evaluate(`([...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim().startsWith('更多')).forEach(b=>b.click()))`)
    await wait(700)
  }
  await waitFor(`Boolean(document.querySelector('button[data-session-id="' + '${SESSION_ID}' + '"]'))`, 'target', 30000)
  await evaluate(`document.querySelector('button[data-session-id="' + '${SESSION_ID}' + '"]').click()`)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages', 60000)
  await wait(2000)

  // 滚动到底部（最新 streaming 消息）
  await evaluate(`(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v){ v.scrollTop=v.scrollHeight } })()`)
  await wait(1000)

  // 启动探针
  await startProbe()
  await kickDomSampler()

  const t0 = Date.now()
  let done = false
  const MAX = 10 * 60 * 1000
  while (Date.now() - t0 < MAX) {
    await wait(2000)
    const mid = await evaluate(`(() => {
      const ta = document.querySelector('textarea[name="message"]')
      const b = ta?.form?.querySelector('button[type=submit]')
      const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
      return { disabled: b?.disabled, label: b?.getAttribute('aria-label'), msgCount: msgs.length, lastMsgNodes: msgs[0]? msgs[0].querySelectorAll('*').length:0, lastMsgTextLen: msgs[0]?(msgs[0].textContent||'').length:0, lastMsgGroups: msgs[0]?msgs[0].querySelectorAll('[data-activity-group]').length:0 }
    })()`)
    const el = ((Date.now()-t0)/1000).toFixed(0)
    // 只打印关键变化
    if (el % 10 === 0) console.log('... el='+el+'s', JSON.stringify(mid))
  }
  console.log('>>> sampler finished after MAX timeout')

  await wait(2000)
  const probe = await stopProbe()
  const domSamples = await stopSampler()
  console.log('>>> RENDER_PROBE:', JSON.stringify(probe, null, 2))
  console.log('>>> DOM_SAMPLES count:', domSamples.length)
  console.log('>>> DOM_SAMPLES (last 20):', JSON.stringify(domSamples.slice(-20), null, 2))
  const final = await evaluate(`(() => { const msgs=[...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index'))); const last=msgs[0]; return last?{nodes:last.querySelectorAll('*').length,textLen:(last.textContent||'').length,groups:last.querySelectorAll('[data-activity-group]').length,openG:last.querySelectorAll('[data-activity-group][data-state="open"]').length,txt:(last.textContent||'').trim().slice(0,60)}:null })()`)
  console.log('>>> FINAL:', JSON.stringify(final, null, 2))
} catch (e) { console.error('ERR', e.message); console.error(e.stack) } finally { cdp.close() }
