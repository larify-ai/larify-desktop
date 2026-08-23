/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../manual/cdp-client.mjs'
import { createWindowController } from './window-control.mjs'

const sampleCount = Number(process.env.LARIFY_MAXIMIZE_AB_SAMPLES ?? 5)
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const metricsByName = (metrics) =>
  Object.fromEntries(metrics.map(({ name, value }) => [name, value]))
const cdp = await connectLarifyCdp()
const setWindowState = createWindowController()
const settle = () =>
  cdp.evaluate(`new Promise((resolve) => {
    const started = performance.now()
    let previous = ''
    let stable = 0
    const frame = (now) => {
      const current = [innerWidth, innerHeight, outerWidth, outerHeight].join(':')
      stable = current === previous ? stable + 1 : 0
      previous = current
      if ((stable >= 3 && now - started >= 100) || now - started >= 2000) {
        const probe = window.__larifyMaximizeAbProbe
        probe.running = false
        resolve({
          maxFrameGapMs: Math.max(...probe.gaps),
          settleMs: now - started,
          size: { height: innerHeight, width: innerWidth }
        })
      } else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })`)

try {
  await cdp.send('Performance.enable')
  const results = { native: [], pseudo: [] }
  for (let index = 0; index < sampleCount; index += 1) {
    for (const mode of ['native', 'pseudo']) {
      setWindowState('normal')
      await wait(400)
      const before = metricsByName((await cdp.send('Performance.getMetrics')).metrics)
      await cdp.evaluate(`(() => {
        const probe = { gaps: [], last: performance.now(), running: true }
        window.__larifyMaximizeAbProbe = probe
        const frame = (now) => {
          probe.gaps.push(now - probe.last)
          probe.last = now
          if (probe.running) requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })()`)
      setWindowState(mode)
      const frame = await settle()
      const after = metricsByName((await cdp.send('Performance.getMetrics')).metrics)
      results[mode].push({
        ...frame,
        layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
        rendererTaskMs: (after.TaskDuration - before.TaskDuration) * 1000,
        styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
      })
    }
  }
  const summarize = (samples) => {
    const median = (key) => {
      const values = samples.map((sample) => sample[key]).sort((left, right) => left - right)
      return values[Math.floor(values.length / 2)]
    }
    return {
      maxFrameGapMs: median('maxFrameGapMs'),
      rendererTaskMs: median('rendererTaskMs'),
      settleMs: median('settleMs')
    }
  }
  console.log(
    JSON.stringify(
      {
        results,
        summary: { native: summarize(results.native), pseudo: summarize(results.pseudo) }
      },
      null,
      2
    )
  )
} finally {
  setWindowState('native')
  cdp.close()
}
