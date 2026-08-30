/* 实测「巨型 activity-group 展开态 reconcile」的真实 DOM 帧成本。
   流程: reload 触发目录刷新 → 打开 perf-mega-session → 定位巨型 assistant 消息
         → 展开 activity-group → 量 rAF gap + longtask + 展开/折叠 toggle 耗时。
   用法: node tests/manual/bench-mega.mjs [N] */
import { connectLarifyCdp } from './cdp-client.mjs'
const N = Number(process.argv[2] ?? 374)
const SESSION_ID = 'perf-mega-session'
let cdp = await connectLarifyCdp()
const evaluate = (expr) => cdp.evaluate(expr)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expression, label, timeout = 120000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const v = await evaluate(expression)
    if (v) return v
    await wait(80)
  }
  throw new Error(`timeout: ${label}`)
}

try {
  // 1. 若侧边栏无 perf-mega => reload 触发目录刷新（Provider 重新挂载会 refresh）
  const hasPerf = await evaluate(`!!document.querySelector('button[data-session-id="${SESSION_ID}"]')`)
  if (!hasPerf) {
    console.log('> sidebar lacks mega session, reloading to refresh directory')
    await evaluate(`location.reload()`)
    await wait(300)
    cdp.close()
    cdp = await connectLarifyCdp() // 重连新页面
    await waitFor(`!!document.querySelector('button[data-session-id="${SESSION_ID}"]')`, 'mega session visible in sidebar', 120000)
    await wait(1500) // 布局稳定
  } else {
    console.log('> mega session already visible')
  }

  // 2. 点击打开 perf-mega-session
  const clicked = await evaluate(`(() => { const b=document.querySelector('button[data-session-id="${SESSION_ID}"]'); if(b){b.click();return true} return false })()`)
  console.log('OPEN_CLICK:', clicked)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages rendered')
  await wait(3000) // 虚拟滚动/layout 稳定

  // 3. 定位巨型 assistant 消息（DOM 节点最多的一条）
  const big = await evaluate(`(() => {
    let best = null, bestCount = -1
    document.querySelectorAll('[data-message-index]').forEach((el) => {
      const c = el.querySelectorAll('*').length
      if (c > bestCount) { bestCount = c; best = el }
    })
    if (!best) return null
    return {
      msgIdx: best.dataset.messageIndex,
      kind: best.dataset.messageKind,
      domNodes: bestCount,
      txtLen: best.textContent.length
    }
  })()`)
  console.log('BIG_MSG:', JSON.stringify(big))

  // 4. 稳态基线（无交互时 rAF gAF）
  const steady = await evaluate(`new Promise((resolve) => {
    const gaps=[]; let last=performance.now(); let rafId
    const onFrame=(t)=>{ gaps.push(t-last); last=t; if(gaps.length<60) rafId=requestAnimationFrame(onFrame); else { cancelAnimationFrame(rafId); const s=[...gaps].sort((a,b)=>a-b); const pct=(p)=>s[Math.min(s.length-1,Math.floor(s.length*p))]|0; resolve({p50:pct(0.5),p95:pct(0.95),max:s[s.length-1]|0,avg:(gaps.reduce((a,b)=>a+b,0)/gaps.length).toFixed(2)}) } }
    requestAnimationFrame(onFrame)
  })`)
  console.log('STEADY:', JSON.stringify(steady))

  // 5. 展开巨型消息 activity-group：找该消息内第一个可展开触发器并点击，测一次 commit 帧成本
  const expand = await evaluate(`new Promise((resolve) => {
    let best=null,bestCount=-1
    document.querySelectorAll('[data-message-index]').forEach((el)=>{ const c=el.querySelectorAll('*').length; if(c>bestCount){bestCount=c;best=el} })
    if(!best){ resolve({error:'no msg'}); return }
    // 收集消息内按钮触发器，优先 aria-expanded/data-state + chevron/summary
    const cands=[...best.querySelectorAll('button,[role="button"],[data-state],[aria-expanded]')]
    const btn=cands.find((b)=>/(展开|收起|activity|工具|步骤|活动|tool|summary)/i.test((b.textContent||'')+' '+(b.getAttribute('aria-label')||''))) || cands[0]
    if(!btn){ resolve({error:'no trigger'}); return }
    // 点击前先记录
    const gaps=[]; let last=performance.now(); const lts=[]; const po=new PerformanceObserver((l)=>{ for(const e of l.getEntries()) lts.push(e.duration) })
    po.observe({entryTypes:['longtask']})
    let phase='click'
    const finish=()=>{ cancelAnimationFrame(rafId); po.disconnect(); const s=[...gaps].sort((a,b)=>a-b); const pct=(p)=>s[Math.min(s.length-1,Math.floor(s.length*p))]|0; resolve({first:gaps[0]|0,p50:pct(0.5),p95:pct(0.95),max:s[s.length-1]|0,longtasks:lts.length,longtaskMs:(lts.reduce((a,b)=>a+b,0))|0,btnText:(btn.textContent||'').trim().slice(0,20),btnAria:btn.getAttribute('aria-expanded'),btnState:btn.getAttribute('data-state')}) }
    const onFrame=(t)=>{ const gap=t-last; last=t; gaps.push(gap); if(phase==='click' && gaps.length>=2){ phase='measuring' } if(gaps.length>=40){ finish(); return } rafId=requestAnimationFrame(onFrame) }
    rafId=requestAnimationFrame(onFrame)
    btn.click()
  })`)
  console.log('EXPAND_COST:', JSON.stringify(expand))

  // 6. 展开后的消息 DOM 规模
  const after = await evaluate(`(() => {
    let best=null,bestCount=-1
    document.querySelectorAll('[data-message-index]').forEach((el)=>{ const c=el.querySelectorAll('*').length; if(c>bestCount){bestCount=c;best=el} })
    if(!best) return null
    return { msgIdx:best.dataset.messageIndex, domNodes:bestCount,
      summaryRows:[...best.querySelectorAll('button,[role="button"]')].length,
      expanded:[...best.querySelectorAll('[aria-expanded="true"],[data-state="open"]')].length }
  })()`)
  console.log('AFTER_EXPAND:', JSON.stringify(after))

} catch (e) {
  console.error('BENCH_ERROR', e.message)
  console.error(e.stack)
} finally { cdp.close() }
