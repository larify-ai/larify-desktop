/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const threadTitle = process.env.LARIFY_PERF_THREAD
if (!threadTitle) throw new Error('LARIFY_PERF_THREAD is required')

const traceScript = fileURLToPath(new URL('./layout-resize-trace.cdp.mjs', import.meta.url))
const limits = {
  resize: {
    p99Ms: 40,
    maxMs: 50,
    framesOver50: 0,
    longAnimationFrames: 0,
    p95PointerLagPx: 8,
    maxPointerLagPx: 16
  },
  scroll: {
    p95Ms: 40,
    p99Ms: 60,
    maxMs: 100,
    framesOver50: 5,
    longAnimationFrames: 0,
    maxVisibleSkeletons: 0
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function summarize(trace, interaction) {
  const samples = trace.metadata.frameTimes
  const relevantSamples =
    interaction === 'scroll'
      ? samples.filter((sample) => sample.scrolling)
      : samples.filter(
          (sample, index) =>
            sample.handleX !== samples[index - 1]?.handleX ||
            sample.handleX !== samples[index + 1]?.handleX
        )
  const frameTimes = relevantSamples
    .map(({ delta }) => delta)
    .filter((delta) => Number.isFinite(delta) && delta >= 0)
  const durations = (name) =>
    trace.traceEvents
      .filter((event) => event.ph === 'X' && event.name === name && Number.isFinite(event.dur))
      .map((event) => event.dur / 1_000)

  const runTasks = durations('RunTask')
  const layouts = durations('Layout')
  const paints = durations('Paint')
  const expectedInvoker = interaction === 'scroll' ? 'onscroll' : 'ResizeObserverCallback'
  const longAnimationFrames = (trace.metadata.longAnimationFrames ?? []).filter((frame) =>
    frame.scripts?.some((script) => script.invoker?.includes(expectedInvoker))
  )
  const longAnimationFrameScripts = longAnimationFrames.flatMap((frame) => frame.scripts ?? [])
  const pointerLag = relevantSamples
    .filter(
      ({ handleX, expectedHandleX }) => Number.isFinite(handleX) && Number.isFinite(expectedHandleX)
    )
    .map(({ handleX, expectedHandleX }) => Math.abs(handleX - expectedHandleX))
  return {
    frames: frameTimes.length,
    averageMs:
      frameTimes.length === 0
        ? 0
        : frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length,
    p95Ms: percentile(frameTimes, 0.95),
    p99Ms: percentile(frameTimes, 0.99),
    maxMs: Math.max(0, ...frameTimes),
    framesOver33: frameTimes.filter((value) => value > 33.3).length,
    framesOver50: frameTimes.filter((value) => value > 50).length,
    longTasks: runTasks.filter((value) => value > 50).length,
    maxTaskMs: Math.max(0, ...runTasks),
    maxLayoutMs: Math.max(0, ...layouts),
    maxPaintMs: Math.max(0, ...paints),
    longAnimationFrames: longAnimationFrames.length,
    maxBlockingDurationMs: Math.max(
      0,
      ...longAnimationFrames.map((frame) => frame.blockingDuration ?? 0)
    ),
    slowestScript: longAnimationFrameScripts.toSorted(
      (left, right) => (right.duration ?? 0) - (left.duration ?? 0)
    )[0],
    p95PointerLagPx: percentile(pointerLag, 0.95),
    maxPointerLagPx: Math.max(0, ...pointerLag),
    maxVisibleSkeletons: Math.max(
      0,
      ...relevantSamples.map((sample) => sample.visibleSkeletonCount ?? 0)
    )
  }
}

function runTrace(action, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [traceScript], {
      env: {
        ...process.env,
        LARIFY_TRACE_ACTION: action,
        LARIFY_TRACE_DISABLED: '1',
        LARIFY_TRACE_OUTPUT: output,
        LARIFY_TRACE_THREAD: threadTitle,
        LARIFY_TRACE_WORKBENCH_RENDERER: 'browser'
      },
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${action} trace exited with code ${code}`))
    })
  })
}

function assertWithin(name, result, limit) {
  const failures = []
  for (const [metric, maximum] of Object.entries(limit)) {
    if (result[metric] > maximum) {
      failures.push(`${metric} ${result[metric].toFixed(1)} > ${maximum}`)
    }
  }
  if (failures.length > 0) throw new Error(`${name} performance regression: ${failures.join(', ')}`)
}

const directory = await mkdtemp(join(tmpdir(), 'larify-layout-performance-'))
try {
  const cases = [
    { name: 'resize', interaction: 'resize', action: 'resize-long' },
    { name: 'resizeFast', interaction: 'resize', action: 'resize-fast' },
    { name: 'scroll', interaction: 'scroll', action: 'scroll-loaded' },
    { name: 'scrollFast', interaction: 'scroll', action: 'scroll-loaded-fast' }
  ]
  const results = {}
  for (const testCase of cases) {
    const output = join(directory, `${testCase.name}.json`)
    await runTrace(testCase.action, output)
    const trace = JSON.parse(await readFile(output, 'utf8'))
    if (trace.metadata.failure) throw new Error(`${testCase.name}: ${trace.metadata.failure}`)
    results[testCase.name] = summarize(trace, testCase.interaction)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  console.log(JSON.stringify({ limits, results }, null, 2))
  for (const testCase of cases) {
    assertWithin(testCase.name, results[testCase.name], limits[testCase.interaction])
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
