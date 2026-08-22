const { app, BrowserWindow, View, WebContentsView } = require('electron')
const { performance } = require('node:perf_hooks')

const percentile = (values, fraction) => {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

const summarize = (values) => ({
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  p99Ms: percentile(values, 0.99),
  maxMs: Math.max(0, ...values)
})

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const measure = async (update) => {
  const durations = []
  for (let index = 0; index < 120; index += 1) {
    const width = Math.round(700 + 300 * Math.sin((index / 30) * Math.PI))
    const started = performance.now()
    update(width)
    durations.push(performance.now() - started)
    await wait(16)
  }
  return summarize(durations)
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 2560,
    height: 1392,
    show: false,
    webPreferences: { backgroundThrottling: false }
  })
  const container = new View()
  const page = new WebContentsView({ webPreferences: { backgroundThrottling: false } })
  window.contentView.addChildView(container)
  container.addChildView(page)
  container.setBounds({ x: 0, y: 0, width: 2560, height: 1392 })
  page.setBounds({ x: 0, y: 0, width: 2560, height: 1392 })
  const cards = Array.from(
    { length: 4_000 },
    (_, index) => `<article><h2>Card ${index}</h2><p>Resize benchmark content ${index}</p></article>`
  ).join('')
  const generatedPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font:14px system-ui}article{padding:12px;border:1px solid #888;border-radius:8px;box-shadow:0 2px 8px #0003}</style>${cards}`)}`
  await page.webContents.loadURL(process.env.LARIFY_BENCHMARK_URL || generatedPage)
  window.showInactive()
  await wait(1_000)

  const webContentsView = await measure((width) => {
    page.setBounds({ x: 2560 - width, y: 0, width, height: 1392 })
  })
  page.setBounds({ x: 0, y: 0, width: 2560, height: 1392 })
  await wait(500)
  const parentView = await measure((width) => {
    container.setBounds({ x: 2560 - width, y: 0, width, height: 1392 })
  })

  process.stdout.write(`${JSON.stringify({ webContentsView, parentView }, null, 2)}\n`)
  window.destroy()
  app.quit()
})
