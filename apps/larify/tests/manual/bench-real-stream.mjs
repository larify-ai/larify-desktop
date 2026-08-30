/* 路径1：真实触发一次 streaming，实测巨型 streaming 消息生成期间的真实 DOM reconcile 帧成本。
   给真实目标会话发一条消息 -> 真实 agent 跑 -> 用 rAF/longtask 探针持续采样，
   特别监测 activity-group(defaultOpen:true) 展开时 DOM 节点数增长。 */
import { connectLarifyCdp } from './cdp-client.mjs'
const SESSION_ID = '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'
const MESSAGE = process.env.PROMPT ?? ''
let cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expr, label, timeout = 90000) => {
  const s = Date.now()
  while (Date.now() - s < timeout) { const v = await evaluate(expr); if (v) return v; await wait(80) }
  throw new Error('timeout ' + label)
}

const startProbe = () => evaluate(`(() => {
  window.__p?.observer?.disconnect()
  const p = { frames: [], last: performance.now(), longTasks: [], running: true, domSamples: [] }
  const frame = (now) => { p.frames.push(now - p.last); p.last = now; if (p.running) requestAnimationFrame(frame) }
  p.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) p.longTasks.push(e.duration) })
  p.observer.observe({ type: 'longtask' })
  window.__p = p
  requestAnimationFrame(frame)
})()`)
// 周期采样 DOM 节点 + 活动组状态
const kickDomSampler = (delayMs = 300) => evaluate(`(() => {
  window.__domSampler?.stop?.()
  const s = { samples: [], running: true, stopF: null }
  const take = () => {
    if (!s.running) return
    // 记录最后一个 assistant 活动组节点规模
    let nodes = 0, groups = 0, openGroups = 0, visibleText = 0
    const hit = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))[0]
    if (hit) { nodes = hit.querySelectorAll('*').length; visibleText = (hit.textContent||'').length }
    groups = document.querySelectorAll('[data-activity-group]').length
    openGroups = [...document.querySelectorAll('[data-activity-group][data-state="open"]')].length
    s.samples.push({ t: Math.round(performance.now()), lastMsgNodes: nodes, visibleText, groups, openGroups })
  }
  const start = Date.now()
  const iv = setInterval(() => {
    if (Date.now() - start > ${delayMs * 200} ) { clearInterval(iv); s.running=false; return }
    take()
  }, ${delayMs})
  s.stopF = () => { clearInterval(iv); s.running = false }
  window.__domSampler = s
  take()
  return true
})()`)
const stopSampler = () => evaluate(`(() => { const s=window.__domSampler; if(s?.stopF) s.stopF(); return (s?.samples ?? []).slice(-10) })()`)
const stopProbe = () => evaluate(`(() => {
  const p = window.__p; p.running = false; p.observer.disconnect()
  const s = p.frames.toSorted((a, b) => a - b)
  const pct = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))] ?? 0
  return { frames: s.length, avgMs: +(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(2), p50Ms: +pct(0.5).toFixed(2), p95Ms: +pct(0.95).toFixed(2), maxMs: Math.max(0, ...s).toFixed(2), longTasks: p.longTasks.length, maxLongTaskMs: Math.max(0, ...p.longTasks).toFixed(2) }
})()`)

if (!MESSAGE) { console.error('set PROMPT env'); process.exit(1) }

try {
  await cdp.send('Page.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait(500)
  cdp.close(); cdp = await connectLarifyCdp()
  await waitFor(`Boolean(document.querySelector('button[data-session-id="${SESSION_ID}"]'))`, 'sidebar')
  await evaluate(`document.querySelector('button[data-session-id="${SESSION_ID}"]')?.click()`)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages')
  await wait(2500)

  // 滚动到底部（新消息底部）
  await evaluate(`(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v){ v.scrollTop=v.scrollHeight } })()`)
  await wait(800)

  // 填文字 -> 触发 React onChange -> 确认提交按钮启用
  const filled = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    if (!ta) return { ok:false, why:'no textarea' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(MESSAGE)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok:true, value: ta.value }
  })()`)
  console.log('>>> filled:', JSON.stringify(filled))
  await wait(600)
  const btn = await evaluate(`(() => {
    const b = [...document.querySelectorAll('textarea[name="message"]')][0]?.form?.querySelector('button[type=submit]')
    return { disabled: b?.disabled, label: b?.getAttribute('aria-label') }
  })()`)
  console.log('>>> submit btn after fill:', JSON.stringify(btn))

  // 启动探针 + DOM sampler
  await startProbe()
  await kickDomSampler()

  // 点击提交（真实 agent:send）
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('textarea[name="message"]')][0]?.form?.querySelector('button[type=submit]')
    if (!b || b.disabled) return { ok:false, disabled:b?.disabled }
    b.click()
    return { ok:true }
  })()`)
  console.log('>>> submit clicked:', JSON.stringify(clicked))

  // 等待 streaming 结束：提交按钮重新变回非禁用(发送态) 且不再 running。轮询最长 15 分钟。
  let done = false
  const t0 = Date.now()
  const MAX = 15 * 60 * 1000
  while (Date.now() - t0 < MAX) {
    await wait(2000)
    const st = await evaluate(`(() => {
      const b = [...document.querySelectorAll('textarea[name="message"]')][0]?.form?.querySelector('button[type=submit]')
      const ta = [...document.querySelectorAll('textarea[name="message"]')][0]
      return { disabled: b?.disabled, label: b?.getAttribute('aria-label'), textHasValue: (ta?.value||'').length>0 }
    })()`)
    // 发送态 = 非禁用 + aria-label=发送（running 时 aria-label=停止/按钮走 onStop）
    if (st && st.disabled === false && st.label !== undefined) {
      // 再等 streaming 尾帧稳定后判断
      done = true
      console.log('>>> streaming finished state:', JSON.stringify(st))
      break
    }
    console.log('... streaming in progress, submit state:', JSON.stringify(st), 'elapsed', ((Date.now()-t0)/1000).toFixed(0)+'s')
  }
  if (!done) console.log('>>> TIMEOUT waiting for streaming finish')

  // 停探针，取结果
  await evaluate(`(() => { const v=document.querySelector('[data-message-scroll-viewport]'); if(v) v.scrollTop=v.scrollHeight })()`)
  await wait(1500)
  const probe = await stopProbe()
  const domSamples = await stopSampler()
  console.log('>>> RENDER_PROBE:', JSON.stringify(probe))
  console.log('>>> DOM_SAMPLES (last 10):', JSON.stringify(domSamples, null, 2))

  // 最终最后一个 activity-group 的展开态节点数
  const final = await evaluate(`(() => {
    const groups = [...document.querySelectorAll('[data-activity-group][data-activity-kind="activity-group"]')]
    const big = groups.sort((a,b)=>b.querySelectorAll('*').length - a.querySelectorAll('*').length)[0]
    return big ? {
      kind: big.getAttribute('data-activity-kind'), state: big.dataset.state,
      nodes: big.querySelectorAll('*').length,
      childGroups: big.querySelectorAll('[data-activity-group]').length,
      txt: (big.textContent||'').trim().slice(0,60)
    } : null
  })()`)
  console.log('>>> FINAL_ACTIVITY_GROUP:', JSON.stringify(final, null, 2))
} catch (e) { console.error('ERR', e.message); console.error(e.stack) } finally { cdp.close() }
