/* 实测「巨型 activity-group 展开态 reconcile」的真实 DOM 帧成本。
   打开 perf-mega-session → 找到巨型 assistant 消息的 activity-group →
   测量展开一次 commit 的: rAF gap p95/p99/max + longtask 次数/总时长 + 展开/折叠往返耗时。
   用法: node tests/manual/bench-expand-reconcile.mjs [N] */
import { connectLarifyCdp } from './cdp-client.mjs'

const N = Number(process.argv[2] ?? 374)
const SESSION_ID = 'perf-mega-session'
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const waitFor = async (expression, label, timeout = 60000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const v = await evaluate(expression)
    if (v) return v
    await wait(50)
  }
  throw new Error(`timeout: ${label}`)
}

try {
  // 1. 打开会话（先切到会话列表，再点目标会话）
  await evaluate(`(() => {
    const list = document.querySelector('button[data-session-id="${SESSION_ID}"]')
    if (list) { list.click(); }
    // 若当前已在会话内，尝试通过侧边栏导航，否则直接注入 React? 先确保在列表页可点
    return true
  })()`)
  await wait(1500)
  const stillList = await evaluate(`document.querySelectorAll('[data-message-index]').length === 0 && document.querySelector('button[data-session-id="${SESSION_ID}"]') !== null`)
  if (stillList) {
    // 在列表页，需离开会话回列表再点。这里直接尝试多次点击会话（幂等）
    await evaluate(`document.querySelector('button[data-session-id="${SESSION_ID}"]')?.click()`)
  }
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages rendered')
  await wait(2500) // 布局/虚拟滚动稳定

  // 2. 定位巨型 assistant 消息（含最多 activity-group 的一条）的折叠触发器
  const target = await evaluate(`(() => {
    const msgs = [...document.querySelectorAll('[data-message-index]')]
    msgs.sort((a, b) => (b.querySelectorAll('[class*="activity"],[class*="tool"]').length) - (a.querySelectorAll('[class*="activity"],[class*="tool"]').length))
    const big = msgs[0]
    if (!big) return null
    // 收集该消息内所有类 activity-group 触发器（svg button 展开折叠）
    const triggers = [...big.querySelectorAll('button,[role="button"],[data-state]')]
      .filter((b) => { const t=(b.textContent||'').trim(); return /展开|收起|activity|工具|步骤|tool/i.test(t) || b.querySelector('svg') })
    const info = triggers.map((b, i) => ({ i, cls:(b.className||'').toString().slice(0,50), aria:b.getAttribute('aria-expanded'), dataState:b.getAttribute('data-state'), txt:(b.textContent||'').trim().slice(0,30), tag:b.tagName }))
    // 也找 Collapsible 的 data-state 触发器
    const collapsibleTriggers = [...big.querySelectorAll('[aria-expanded],[data-state]')].map((b)=>({tag:b.tagName, role:b.getAttribute('role'), aria:b.getAttribute('aria-expanded'), dataState:b.getAttribute('data-state'), cls:(b.className||'').toString().slice(0,40), txt:(b.textContent||'').trim().slice(0,30)}))
    return { msgIdx: big.dataset.messageIndex, triggerCount: triggers.length, triggers: info.slice(0,30), collapsibleTriggers: collapsibleTriggers.slice(0,60) }
  })()`)
  console.log('TARGET:', JSON.stringify(target, null, 2))

  // 3. 用 rAF probe + longtask 测量「展开一次」的帧/阻塞成本
  const measureExpand = await evaluate(`new Promise((resolve) => {
    const rAFGaps = []
    let last = performance.now()
    let rafId
    const longtasks = []
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longtasks.push({ dur: e.duration, start: e.startTime })
    })
    po.observe({ entryTypes: ['longtask'] })
    const onFrame = (t) => {
      rAFGaps.push(t - last)
      last = t
      if (rAFGaps.length < 60) { rafId = requestAnimationFrame(onFrame) }
      else {
        cancelAnimationFrame(rafId)
        po.disconnect()
        const sorted = [...rAFGaps].sort((a, b) => a - b)
        const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] | 0
        const totalLT = longtasks.reduce((a, e) => a + e.dur, 0)
        resolve({
          frames: rAFGaps.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1] | 0,
          longtasks: longtasks.length, longtaskTotalMs: totalLT | 0, avg: (rAFGaps.reduce((a,b)=>a+b,0)/rAFGaps.length).toFixed(2)
        })
      }
    }
    requestAnimationFrame(onFrame)
  })`)
  console.log('BASELINE_STEADY:', JSON.stringify(measureExpand))

  // 4. 找可点击的 activity-group 展开触发器并点击（用 selector 保守：取 big 内的 summary/icon 按钮）
  const clicked = await evaluate(`(() => {
    const msgs = [...document.querySelectorAll('[data-message-index]')]
    msgs.sort((a, b) => (b.querySelectorAll('[class*="activity"],[class*="tool"]').length) - (a.querySelectorAll('[class*="activity"],[class*="tool"]').length))
    const big = msgs[0]
    if (!big) return false
    // 尝试找 data-state 的按钮（Collapsible trigger），点击第一个非展开态
    const candidates = [...big.querySelectorAll('button, [role="button"]')].filter((b) => b.getAttribute('aria-expanded') === 'false' || b.getAttribute('data-state') === 'closed' || !b.getAttribute('aria-expanded'))
    const btn = candidates[0]
    if (btn) { btn.click(); return { clicked: true, cls: (btn.className||'').toString().slice(0,60) } }
    return false
  })()`)
  console.log('CLICKED:', JSON.stringify(clicked))

  // 5. 展开后立即测量一次 commit 的成本（rAF + longtask）
  const expandCost = await evaluate(`new Promise((resolve) => {
    const rAFGaps = []
    let last = performance.now()
    let rafId = requestAnimationFrame(onFrame)
    function onFrame(t) {
      rAFGaps.push(t - last)
      last = t
      if (rAFGaps.length < 40) { rafId = requestAnimationFrame(onFrame) }
      else {
        cancelAnimationFrame(rafId)
        const sorted = [...rAFGaps].sort((a, b) => a - b)
        const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] | 0
        resolve({ frames: rAFGaps.length, first: rAFGaps[0]|0, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length-1]|0, avg: (rAFGaps.reduce((a,b)=>a+b,0)/rAFGaps.length).toFixed(2) })
      }
    }
  })`)
  console.log('EXPAND_COST:', JSON.stringify(expandCost))

  // 6. 展开后的 DOM 规模
  const after = await evaluate(`(() => {
    const msgs = [...document.querySelectorAll('[data-message-index]')]
    msgs.sort((a, b) => (b.querySelectorAll('[class*="activity"],[class*="tool"]').length) - (a.querySelectorAll('[class*="activity"],[class*="tool"]').length))
    const big = msgs[0]
    if (!big) return null
    return {
      msgIdx: big.dataset.messageIndex,
      domNodes: big.querySelectorAll('*').length,
      summaryRows: big.querySelectorAll('[class*="summary"],[class*="activity-item"],[class*="tool-group"]').length,
      expandedState: [...big.querySelectorAll('[aria-expanded="true"],[data-state="open"]')].length
    }
  })()`)
  console.log('AFTER_EXPAND:', JSON.stringify(after))

  // 7. 反复 toggle N 次模拟「每 chunk 全量 reconcile」，测单次 toggle 平均耗时（同步）
  const toggleCost = await evaluate(`new Promise((resolve) => {
    const msgs = document.querySelectorAll('[data-message-index]')
    let big; [...msgs].forEach((m, i) => { const c = m.querySelectorAll('[class*="activity"],[class*="tool"]').length; if (!big || c > big.c) big = i })
    const target = msgs[big]
    const findTrig = () => [...target.querySelectorAll('button,[role="button"]')].find((b) => b.getAttribute('aria-expanded') === 'true' || b.getAttribute('data-state') === 'open' || b.querySelector('[class*="chevron"],[aria-label]'))
    const reps = 20
    const times = []
    requestAnimationFrame(() => {
      let btn = findTrig()
      for (let i = 0; i < reps; i++) {
        if (!btn) break
        const t0 = performance.now()
        btn.click()
        // 强制同步同步布局读取，模拟 reconcile 完成
        const _forcedLayout = target.offsetHeight
        times.push(((performance.now() - t0) * 1000) | 0) // µs
        btn = findTrig()
      }
      const sorted = [...times].sort((a, b) => a - b)
      const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] | 0
      resolve({ n: times.length, avgUs: (times.reduce((a,b)=>a+b,0)/Math.max(1,times.length))|0, p50Us: pct(0.5), p95Us: pct(0.95), minUs: sorted[0], maxUs: sorted[sorted.length-1] })
    })
  })`)
  console.log('TOGGLE_COST:', JSON.stringify(toggleCost))

} catch (e) {
  console.error('BENCH_ERROR', e.message)
  console.error(e.stack)
} finally {
  cdp.close()
}
