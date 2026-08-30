/* Baseline 复现：新建一个对话 -> 提交能激发巨型输出的提示词 -> 全程测量。
   测量：rAF 帧间隔（p50/p95/max）+ PerformanceObserver longtask + DOM sampler
   （每 100ms 记录最后一条 assistant 消息 DOM 节点数 / activity-group 数量 / open 数），
   输出「DOM 节点数 vs 帧间隔」相关性：验证「活跃 streaming 巨型消息全量 reconcile 压垮渲染线程」。
   结束：DB 验证消息确实进了新建会话。 */
import { DatabaseSync } from 'node:sqlite'
import { connectLarifyCdp } from './cdp-client.mjs'

const MESSAGE =
  process.env.PROMPT_MSG ??
  '请对 D:\\Workspace\\larify-desktop 项目做一次全面的代码审查：逐个文件分析 apps/larify 的 main 进程、renderer、extensions 关键模块，指出性能问题与优化建议，不要修改任何代码，每个文件给出具体分析。'

const db = new DatabaseSync('C:/Users/hylnb/AppData/Roaming/larify/sessions.db')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const waitFor = async (expr, label, timeout = 90000) => {
  const s = Date.now()
  while (Date.now() - s < timeout) {
    const v = await evaluate(expr)
    if (v) return v
    await wait(150)
  }
  throw new Error('timeout ' + label)
}

// rAF 探针：每帧记录 gap + 该时刻最后一条 assistant 消息 DOM 节点数
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

// DOM 采样器：每 100ms
const kickDomSampler = () => evaluate(`(() => {
  window.__domSampler?.stop?.()
  const s = { samples: [], running: true, stopF: null }
  const take = () => {
    if (!s.running) return
    const groups = [...document.querySelectorAll('[data-activity-group]')]
    const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
    let lastNodes = 0, openGroups = 0
    if (msgs[0]) lastNodes = msgs[0].querySelectorAll('*').length
    openGroups = groups.filter(g => g.dataset.state === 'open').length
    s.samples.push({ t: Math.round(performance.now()), lastNodes, groupCount: groups.length, openGroups, msgCount: msgs.length })
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
  for (const f of p.frames) {
    const b = Math.floor(f.nodes / 50) * 50
    nodeBuckets[b] = nodeBuckets[b] || []
    nodeBuckets[b].push(f.gap)
  }
  const nodeStats = {}
  for (const [b, arr] of Object.entries(nodeBuckets)) {
    const s2 = arr.toSorted((a,b)=>a-b)
    const pctA = (f) => s2[Math.min(s2.length-1, Math.floor(s2.length*f))]
    nodeStats[+b] = { n: s2.length, avg: +(s2.reduce((a,c)=>a+c,0)/s2.length).toFixed(1), p95: +pctA(0.95).toFixed(1), max: +s2[s2.length-1].toFixed(1) }
  }
  return {
    frames: p.frames.length,
    avgMs: +(gaps.reduce((a,b)=>a+b,0)/Math.max(1,gaps.length)).toFixed(2),
    p50Ms: +pct(0.5).toFixed(2), p95Ms: +pct(0.95).toFixed(2), maxMs: +maxGap.toFixed(2),
    longTasks: p.longTasks.length,
    maxLongTaskMs: +(Math.max(0,...p.longTasks.map(l=>l.d))).toFixed(2),
    longTaskOver100: p.longTasks.filter(l=>l.d>100).length,
    nodeVsGap: nodeStats
  }
})()`)

try {
  await cdp.send('Page.enable')

  // 1) 新建任务（点击侧边栏"新建任务"按钮）
  const created = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="在 larify-desktop 中新建任务"]')
    if (!btn) return { ok: false, why: 'no new-task button' }
    btn.click()
    return { ok: true }
  })()`)
  console.log('>>> new task clicked:', JSON.stringify(created))
  await wait(1500)

  // 2) 等 composer 就绪（textarea 存在即可）
  await waitFor(`Boolean(document.querySelector('textarea[name="message"]'))`, 'composer', 30000)

  // 3) 填字（原生 setter + input 触发 React state）
  const filled = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    if (!ta) return { ok: false, why: 'no textarea' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(MESSAGE)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: ta.value.slice(0, 40) }
  })()`)
  console.log('>>> filled:', JSON.stringify(filled))
  await wait(800)
  const btnState = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    const b = ta?.form?.querySelector('button[type=submit]')
    return { disabled: b?.disabled, label: b?.getAttribute('aria-label') }
  })()`)
  console.log('>>> submit btn after fill:', JSON.stringify(btnState))
  if (btnState?.disabled) {
    console.error('ABORT: submit still disabled')
    process.exit(1)
  }

  // 4) 启动探针
  await startProbe()
  await kickDomSampler()

  // 5) 提交
  const clicked = await evaluate(`(() => {
    const ta = document.querySelector('textarea[name="message"]')
    const b = ta?.form?.querySelector('button[type=submit]')
    if (!b || b.disabled) return { ok: false, disabled: b?.disabled }
    b.click()
    return { ok: true }
  })()`)
  console.log('>>> submit clicked:', JSON.stringify(clicked))

  // 6) 等待 streaming 结束（发送按钮重新可用/停止态消失）
  const t0 = Date.now()
  let done = false
  const MAX = 20 * 60 * 1000
  while (Date.now() - t0 < MAX) {
    await wait(3000)
    const st = await evaluate(`(() => {
      const ta = document.querySelector('textarea[name="message"]')
      const b = ta?.form?.querySelector('button[type=submit]')
      const msgs = [...document.querySelectorAll('[data-message-index]')].sort((a,b)=>Number(b.getAttribute('data-message-index'))-Number(a.getAttribute('data-message-index')))
      return {
        disabled: b?.disabled, label: b?.getAttribute('aria-label'),
        taValue: (ta?.value || '').length,
        msgCount: msgs.length,
        lastMsgNodes: msgs[0] ? msgs[0].querySelectorAll('*').length : 0,
        lastMsgTextLen: msgs[0] ? (msgs[0].textContent || '').length : 0
      }
    })()`)
    const el = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`... el=${el}s`, JSON.stringify(st))
    if (st && st.disabled === true && st.taValue === 0 && el > 10) {
      // 发送按钮回到 disabled（无输入）+ 输入框已清空 => streaming 结束
      done = true
      console.log('>>> streaming finished:', JSON.stringify(st))
      break
    }
  }
  if (!done) console.log('>>> TIMEOUT waiting for streaming finish')

  await wait(2000)
  const probe = await stopProbe()
  const domSamples = await stopSampler()
  console.log('>>> RENDER_PROBE:', JSON.stringify(probe, null, 2))
  console.log('>>> DOM_SAMPLES count:', domSamples.length)
  console.log('>>> DOM_SAMPLES (nodes>200 或尾部 15):', JSON.stringify(domSamples.filter(s=>s.lastNodes>200).slice(-15), null, 2))

  // 7) DB 验证：消息进了哪个会话
  const verify = db
    .prepare(
      `SELECT m.session_id, s.title, m.position, length(m.value) AS len,
              json_array_length(json_extract(m.value, '$.parts')) AS partsCount,
              json_extract(m.value, '$.metadata.completedAt') AS completedAt,
              json_extract(m.value, '$.metadata.totalProcessingMs') AS totalMs
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.value LIKE ? ORDER BY m.position DESC LIMIT 3`
    )
    .all(`%${MESSAGE.slice(0, 20)}%`)
  console.log('>>> DB VERIFY (消息落库):', JSON.stringify(verify, null, 2))
} catch (e) {
  console.error('ERR', e.message)
  console.error(e.stack)
} finally {
  cdp.close()
  db.close()
}
