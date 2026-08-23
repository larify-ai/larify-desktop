/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../manual/cdp-client.mjs'
import { createWindowController } from './window-control.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

const cdp = await connectLarifyCdp()
const setWindowState = createWindowController()
const events = []
let complete
const completed = new Promise((resolve) => (complete = resolve))
const removeListener = cdp.onEvent((message) => {
  if (message.method === 'Tracing.dataCollected') events.push(...message.params.value)
  if (message.method === 'Tracing.tracingComplete') complete()
})

try {
  setWindowState('restore')
  await wait(500)
  await cdp.send('Tracing.start', {
    categories:
      'benchmark,cc,gpu,viz,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-gpu.service,disabled-by-default-viz.debug.overlay_planes',
    options: 'record-as-much-as-possible',
    transferMode: 'ReportEvents'
  })
  await cdp.evaluate(`performance.mark('larify-maximize-start')`)
  setWindowState('maximize')
  await wait(500)
  await cdp.evaluate(`performance.mark('larify-maximize-end')`)
  await cdp.send('Tracing.end')
  await Promise.race([
    completed,
    wait(10_000).then(() => {
      throw new Error('Tracing completion timed out.')
    })
  ])

  const threadNames = new Map()
  for (const event of events) {
    if (event.name === 'thread_name') threadNames.set(`${event.pid}:${event.tid}`, event.args?.name)
  }
  const timed = events
    .filter((event) => event.ph === 'X' && event.dur > 0)
    .map((event) => ({
      category: event.cat,
      durationMs: event.dur / 1000,
      name: event.name,
      thread: threadNames.get(`${event.pid}:${event.tid}`) ?? `${event.pid}:${event.tid}`
    }))
  const relevant = timed
    .filter(
      ({ category, durationMs, name }) =>
        durationMs >= 1 &&
        /gpu|viz|cc|compositor|frame|draw|swap|reshape|resize/i.test(`${category} ${name}`)
    )
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 30)
  const longest = timed
    .filter(({ durationMs }) => durationMs >= 2)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 20)
  const limits = { gpuTaskMs: 20, rendererMainMs: 20, swapOrPresentMs: 10 }
  const maxima = {
    gpuTaskMs: Math.max(
      0,
      ...timed.filter(({ thread }) => thread === 'CrGpuMain').map(({ durationMs }) => durationMs)
    ),
    rendererMainMs: Math.max(
      0,
      ...timed
        .filter(({ thread }) => thread === 'CrRendererMain')
        .map(({ durationMs }) => durationMs)
    ),
    swapOrPresentMs: Math.max(
      0,
      ...timed
        .filter(({ name }) => /SwapBuffers|Present/.test(name))
        .map(({ durationMs }) => durationMs)
    )
  }
  console.log(
    JSON.stringify({ eventCount: events.length, limits, longest, maxima, relevant }, null, 2)
  )
  for (const [metric, limit] of Object.entries(limits)) {
    if (maxima[metric] > limit) {
      throw new Error(`${metric} ${maxima[metric].toFixed(1)}ms exceeded ${limit}ms.`)
    }
  }
} finally {
  removeListener()
  setWindowState('maximize')
  cdp.close()
}
