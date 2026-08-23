/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../manual/cdp-client.mjs'
import { createWindowController } from './window-control.mjs'

const sampleCount = Number(process.env.LARIFY_MAXIMIZE_SAMPLES ?? 5)
const limits = { layoutMs: 20, maxFrameGapMs: 100, styleMs: 20 }
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const metricsByName = (metrics) =>
  Object.fromEntries(metrics.map(({ name, value }) => [name, value]))

const cdp = await connectLarifyCdp()
const setWindowState = createWindowController()

const rendererState = () =>
  cdp.evaluate(`({
    dpr: devicePixelRatio,
    inner: { height: innerHeight, width: innerWidth },
    outer: { height: outerHeight, width: outerWidth },
    screen: {
      availHeight: screen.availHeight,
      availWidth: screen.availWidth,
      height: screen.height,
      width: screen.width
    }
  })`)

const settleFrames = () =>
  cdp.evaluate(`new Promise((resolve) => {
    const started = performance.now()
    let previous = ''
    let stable = 0
    let frames = 0
    const gaps = []
    let lastFrame = started
    const frame = (now) => {
      gaps.push(now - lastFrame)
      lastFrame = now
      const current = [innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio].join(':')
      stable = current === previous ? stable + 1 : 0
      previous = current
      frames += 1
      if ((stable >= 3 && now - started >= 100) || now - started >= 2000) {
        resolve({ frames, maxFrameGapMs: Math.max(...gaps), settleMs: now - started })
      } else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })`)

try {
  await cdp.send('Performance.enable')
  const samples = []
  for (let index = 0; index < sampleCount; index += 1) {
    setWindowState('restore')
    await wait(400)

    const before = metricsByName((await cdp.send('Performance.getMetrics')).metrics)
    await cdp.evaluate(`(() => {
      const probe = { gaps: [], last: performance.now(), running: true }
      window.__larifyMaximizeProbe = probe
      const frame = (now) => {
        probe.gaps.push(now - probe.last)
        probe.last = now
        if (probe.running) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })()`)
    setWindowState('maximize')
    const frame = await settleFrames()
    const after = metricsByName((await cdp.send('Performance.getMetrics')).metrics)
    const probe = await cdp.evaluate(`(() => {
      window.__larifyMaximizeProbe.running = false
      return { maxFrameGapMs: Math.max(...window.__larifyMaximizeProbe.gaps) }
    })()`)
    const state = await rendererState()
    samples.push({
      ...frame,
      ...probe,
      dpr: state.dpr,
      index: index + 1,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      physicalPixels: Math.round(state.inner.width * state.inner.height * state.dpr ** 2),
      rendererTaskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      state,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
    })
  }
  console.log(JSON.stringify({ limits, samples }, null, 2))
  const regression = samples.find(
    (sample) =>
      sample.layoutMs > limits.layoutMs ||
      sample.maxFrameGapMs > limits.maxFrameGapMs ||
      sample.styleMs > limits.styleMs
  )
  if (regression) throw new Error(`Renderer maximize regression in sample ${regression.index}.`)
} finally {
  setWindowState('maximize')
  cdp.close()
}
