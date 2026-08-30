/* 精确定位巨型 assistant 消息的 activity-group 折叠 summary 按钮，展开并实测 DOM reconcile 帧成本。
   （该展开态 = streaming 时 activity-group defaultOpen:true 的渲染内容：374 个折叠 tool-group 摘要行）*/
import { connectLarifyCdp } from './cdp-client.mjs'
const cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // 1. 定位「已完成 · 处理了」的 activity-group summary 触发器（数据态 closed）
  const trigger = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[data-state]')]
    const t = btns.find((b) => /已完成/.test(b.textContent || ''))
    if (!t) return null
    const rect = t.getBoundingClientRect()
    return {
      dataState: t.getAttribute('data-state'),
      aria: t.getAttribute('aria-expanded'),
      txt: t.textContent.trim().slice(0, 30),
      visible: rect.width > 0 && rect.height > 0
    }
  })()`)
  console.log('TRIGGER:', JSON.stringify(trigger))

  // 2. 稳态基线
  const steady = await evaluate(`new Promise((resolve) => {
    const gaps=[]; let last=performance.now(); let rafId
    const onFrame=(t)=>{ gaps.push(t-last); last=t; if(gaps.length<90){ rafId=requestAnimationFrame(onFrame) } else { cancelAnimationFrame(rafId); const s=[...gaps].sort((a,b)=>a-b); const pct=(p)=>s[Math.min(s.length-1,Math.floor(s.length*p))]|0; resolve({p50:pct(0.5),p95:pct(0.95),p99:pct(0.99),max:s[s.length-1]|0,avg:(gaps.reduce((a,b)=>a+b,0)/gaps.length).toFixed(2)}) } }
    requestAnimationFrame(onFrame)
  })`)
  console.log('STEADY:', JSON.stringify(steady))

  // 3. 点击展开，测一次 commit（首帧 gap + longtask）
  const expandCost = await evaluate(`new Promise((resolve) => {
    const btn=[...document.querySelectorAll('button[data-state]')].find((b)=>/已完成/.test(b.textContent||''))
    if(!btn){ resolve({error:'no trigger'}); return }
    const gaps=[]; let last=performance.now(); const lts=[]; const t0=performance.now()
    const po=new PerformanceObserver((l)=>{ for(const e of l.getEntries()) lts.push(e.duration) })
    po.observe({entryTypes:['longtask']})
    const rafId=requestAnimationFrame(onFrame)
    function onFrame(t){ gaps.push(t-last); last=t; if(gaps.length<45){ requestAnimationFrame(onFrame) } else { cancelAnimationFrame(rafId); po.disconnect(); const s=[...gaps].sort((a,b)=>a-b); const pct=(p)=>s[Math.min(s.length-1,Math.floor(s.length*p))]|0; const el=document.querySelector('[data-message-index="1"]'); resolve({ firstFrameMs:gaps[0]|0, p50:pct(0.5), p95:pct(0.95), max:s[s.length-1]|0, longtasks:lts.length, longtaskMs:(lts.reduce((a,b)=>a+b,0))|0, elapsedMs:(performance.now()-t0)|0, postNodes: el? el.querySelectorAll('*').length:0 }) } }
    btn.click()
  })`)
  console.log('EXPAND_COST:', JSON.stringify(expandCost))

  // 4. 展开后 DOM 规模（374 个摘要行的实际数量）
  await wait(500)
  const after = await evaluate(`(() => {
    const msg=document.querySelector('[data-message-index="1"]')
    if(!msg) return null
    const summaryBtns=[...msg.querySelectorAll('button')].filter((b)=>/读取样本|group\\/summary|summary/.test(b.className.toString()) || /读取样本/.test(b.textContent||'')).length
    return {
      nodes: msg.querySelectorAll('*').length,
      allButtons: msg.querySelectorAll('button').length,
      toolGroups: msg.querySelectorAll('[data-tool-group]').length,
      collapsibles: msg.querySelectorAll('[data-state]').length,
      summaryLike: summaryBtns,
      heightPx: msg.offsetHeight
    }
  })()`)
  console.log('AFTER_EXPAND:', JSON.stringify(after))

  // 5. 折叠-展开往返 N 次，测单次 toggle 平均同步 cost（模拟每 chunk 全量 reconcile）
  const toggle = await evaluate(`new Promise((resolve) => {
    const findBtn=()=>[...document.querySelectorAll('button[data-state]')].find((b)=>/已完成/.test(b.textContent||''))
    const reps=20; const timeMicro=[]
    const doToggle=()=>{ let btn=findBtn(); if(!btn){ resolve({error:'lost trigger'}); return } let i=0
      const step=()=>{ if(i>=reps){ resolve({n:reps, avgUs:(timeMicro.reduce((a,b)=>a+b,0)/reps)|0, p50Us:[...timeMicro].sort((a,b)=>a-b)[reps>>1]|0, maxUs:[...timeMicro].sort((a,b)=>a-b)[reps-1]|0 }); return } const t=performance.now(); btn.click(); const force=document.body.offsetHeight; timeMicro.push((performance.now()-t)*1000); i++; btn=findBtn(); requestAnimationFrame(step) }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(doToggle)
  })`)
  console.log('TOGGLE_COST:', JSON.stringify(toggle))

} catch (e) { console.error('ERR', e.message); console.error(e.stack) } finally { cdp.close() }
