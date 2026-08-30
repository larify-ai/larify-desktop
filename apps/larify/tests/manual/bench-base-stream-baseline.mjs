/* 建 baseline：可靠复现「活跃 streaming 巨型消息」→ 测真实帧成本。
   - 打开目标会话(02a5241f)并验证
   - 用原生 setter+input 触发 React state（submitEnabled 确认）
   - 提交能激发巨型输出的提示词（不修码）
   - rAF 探针记录每帧间隔 + PerformanceObserver longtask
   - DOM sampler 记录每帧时刻最后一条 assistant 消息 DOM 节点数
   - 输出相关性（节点数 vs 帧间隔） */
import { connectLarifyCdp } from './cdp-client.mjs'
const SESSION_ID = '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'
const MESSAGE = process.env.PROMPT_MSG ?? '找出项目所有可优化点，逐文件详细 review 分析，给出每文件的具体建议，不要修改代码'
let cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expr, label, timeout = 90000) => {
  const s = Date.now()
  while (Date.now() - s < timeout) { const v = await evaluate(expr); if (v) return v; await wait(100) }
  throw new Error('timeout ' + label)
}

// rAF 探针：记录每帧间隔 + 当前最后一条 assistant 消息 DOM 节点数
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

// DOM 采样器：每 100ms 记录最后一条 assistant 消息 DOM 节点数 + activity-group 状态
const kickDomSampler = () => evaluate(`(() => {
  window.__domSampler?.stop?.()
  const s = { samples: [], running: true, stopF: null }
  const take = () => {
    if (!s.running) return
    const groups = [...document.querySelectorAll('[data-activity-group]')]
    // 找最后一条 assistant 消息（data-message-index 最大）
    const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
    let lastNodes = 0, openGroups = 0, groupCount = groups.length
    if (msgs[0]) { lastNodes = msgs[0].querySelectorAll('*').length }
    openGroups = groups.filter(g => g.dataset.state === 'open').length
    const rec = { t: Math.round(performance.now()), lastNodes, groupCount, openGroups, msgCount: msgs.length }
    s.samples.push(rec)
    // 同步给 rAF probe
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
  // 分析：节点数 vs 长帧关联
  const nodeBuckets = {}
  for (const f of p.frames) {
    const b = Math.floor(f.nodes / 100) * 100
    nodeBuckets[b] = nodeBuckets[b] || []
    nodeBuckets[b].push(f.gap)
  }
  const nodeStats = {}
  for (const [b, arr] of Object.entries(nodeBuckets)) {
    const s = arr.toSorted((a,b)=>a-b)
    const pctA = (f) => s[Math.min(s.length-1, Math.floor(s.length*f))]
    nodeStats[+b] = { n: s.length, avg: +(s.reduce((a,c)=>a+c,0)/s.length).toFixed(1), p95: +pctA(0.95).toFixed(1), max: +s[s.length-1].toFixed(1) }
  }
  return {
    frames: p.frames.length,
    avgMs: +(gaps.reduce((a,b)=>a+b,0)/Math.max(1,gaps.length)).toFixed(2),
    p50Ms: +pct(0.5).toFixed(2), p95Ms: +pct(0.95).toFixed(2), maxMs: +maxGap.toFixed(2),
    longTasks: p.longTasks.length, maxLongTaskMs: +(Math.max(0,...p.longTasks.map(l=>l.d))).toFixed(2),
    nodeVsGap: nodeStats
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
  await wait(2500)

  // 滚动到底部
  await evaluate(`(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v){ v.scrollTop=v.scrollHeight } })()`)
  await wait(800)

  // 填字（原生 setter + input 触发 React state）
  const filled = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    if (!ta) return { ok:false, why:'no textarea' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(MESSAGE)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok:true, value: ta.value.slice(0,40) }
  })()`)
  console.log('>>> filled:', JSON.stringify(filled))
  await wait(600)
  const btn = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    const b = ta?.form?.querySelector('button[type=submit]')
    return { disabled: b?.disabled, label: b?.getAttribute('aria-label') }
  })()`)
  console.log('>>> submit btn after fill:', JSON.stringify(btn))
  if (btn?.disabled) { console.error('ABORT: submit disabled'); process.exit(1) }

  // 启动探针 + DOM sampler
  await startProbe()
  await kickDomSampler()

  const t0 = Date.now()
  // 提交
  const clicked = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    const b = ta?.form?.querySelector('button[type=submit]')
    if (!b || b.disabled) return { ok:false, disabled:b?.disabled }
    b.click()
    return { ok:true }
  })()`)
  console.log('>>> submit clicked:', JSON.stringify(clicked))

  // 采样中间状态（前 40 秒每 2s 打印一次 DOM 状态）
  let done = false
  const MAX = 12 * 60 * 1000
  while (Date.now() - t0 < MAX) {
    await wait(2000)
    const mid = await evaluate(`(() => {
      const ta = document.querySelector('textarea[name="message"]')
      const b = ta?.form?.querySelector('button[type=submit]')
      const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
      return { disabled: b?.disabled, label: b?.getAttribute('aria-label'), msgCount: msgs.length, lastMsgNodes: msgs[0]? msgs[0].querySelectorAll('*').length : 0, lastMsgTextLen: msgs[0]?(msgs[0].textContent||'').length:0 }
    })()`)
    const elapsed = ((Date.now()-t0)/1000).toFixed(0)
    console.log('... mid el='+elapsed+'s', JSON.stringify(mid))
    // streaming 结束标志：发送按钮恢复且 textarea 空
    if (mid && mid.disabled === false && mid.label === '发送' && elapsed > 5) {
      done = true
      console.log('>>> streaming finished state:', JSON.stringify(mid))
      break
    }
  }
  if (!done) console.log('>>> TIMEOUT waiting for streaming finish')

  await wait(2000)
  const probe = await stopProbe()
  const domSamples = await stopSampler()
  console.log('>>> RENDER_PROBE:', JSON.stringify(probe, null, 2))
  console.log('>>> DOM_SAMPLES count:', domSamples.length)
  console.log('>>> DOM_SAMPLES (last 15):', JSON.stringify(domSamples.slice(-15), null, 2))

  // 最终最后一条 assistant 消息
  const final = await evaluate(`(() => {
    const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
    const last = msgs[0]
    return last ? { nodes: last.querySelectorAll('*').length, textLen: (last.textContent||'').length, txt: (last.textContent||'').trim().slice(0,60), groups: last.querySelectorAll('[data-activity-group]').length, openGroups: last.querySelectorAll('[data-activity-group][data-state="open"]').length } : null
  })()`)
  console.log('>>> FINAL_ASSISTANT_MSG:', JSON.stringify(final, null, 2))
} catch (e) { console.error('ERR', e.message); console.error(e.stack) } finally { cdp.close() }
