// 抓取滚动期间的 CPU profile，定位长任务热点
import { connectLarifyCdp } from './cdp-client.mjs'

const cdp = await connectLarifyCdp()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const TARGET = process.env.PROBE_SESSION_ID ?? '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'
await cdp.evaluate(`(() => {
  const b = document.querySelector('button[data-session-id="${TARGET}"]')
  if (b) b.click()
  return true
})()`)
await wait(1500)
const count = await cdp.evaluate(`document.querySelectorAll('[data-message-index]').length`)
console.log('rendered messages:', count)
if (!count) { console.log('NO_MESSAGES'); cdp.close(); process.exit(0) }

await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')

const scrollInfo = await cdp.evaluate(`(async () => {
  const viewport = document.querySelector('[data-message-scroll-viewport]')
  const longTasks = []
  const ob = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) longTasks.push({ duration: e.duration, start: e.startTime })
  })
  ob.observe({ type: 'longtask' })
  viewport.scrollTop = viewport.scrollHeight
  await new Promise((r) => setTimeout(r, 400))
  for (let i = 0; i < 80; i += 1) {
    viewport.scrollTop -= 160
    await new Promise((r) => requestAnimationFrame(r))
  }
  ob.disconnect()
  return { longTasks: longTasks.map((t) => Math.round(t.duration)), max: longTasks.length ? Math.round(Math.max(...longTasks.map(t=>t.duration))) : 0 }
})()`)

const { profile } = await cdp.send('Profiler.stop')
console.log('longTasks(ms):', JSON.stringify(scrollInfo.longTasks))

// 分析 profile：按 self time 聚合
const byId = new Map()
for (const n of profile.nodes) byId.set(n.id, n)
const selfSamples = new Map()
const total = profile.samples.length
for (const id of profile.samples) selfSamples.set(id, (selfSamples.get(id) ?? 0) + 1)

const durationMs = (profile.endTime - profile.startTime) / 1000
const rows = [...selfSamples.entries()].map(([id, c]) => {
  const n = byId.get(id)
  const cf = n?.callFrame ?? {}
  const url = (cf.url || '').replace(/^https?:\/\/[^/]+\//, '').split('?')[0]
  return {
    name: cf.functionName || '(anonymous)',
    url,
    line: cf.lineNumber,
    selfMs: (c / total) * durationMs
  }
}).sort((a, b) => b.selfMs - a.selfMs)

console.log(`\nprofile window: ${durationMs.toFixed(0)}ms, samples=${total}`)
console.log('\n--- Top 25 by self time ---')
for (const r of rows.slice(0, 25)) {
  console.log(
    `  ${r.selfMs.toFixed(1).padStart(8)}ms  ${r.name.slice(0, 42).padEnd(42)} ${r.url}:${r.line}`
  )
}

// 按 url 聚合
const byUrl = new Map()
for (const r of rows) {
  const key = r.url || '(native/vm)'
  byUrl.set(key, (byUrl.get(key) ?? 0) + r.selfMs)
}
console.log('\n--- 按文件聚合 ---')
for (const [url, ms] of [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${ms.toFixed(1).padStart(8)}ms  ${url}`)
}
cdp.close()
