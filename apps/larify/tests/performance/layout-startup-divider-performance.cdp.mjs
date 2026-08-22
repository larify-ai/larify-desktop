/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const traceScript = fileURLToPath(new URL('./layout-resize-trace.cdp.mjs', import.meta.url))
const limits = {
  p95Ms: 50,
  maxMs: 100,
  framesOver50: 2,
  maxGpuTaskMs: 50,
  browserBoundsUpdates: 0
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function summarize(trace) {
  const samples = trace.metadata.frameTimes.filter(
    ({ handleX, expectedHandleX }) => Number.isFinite(handleX) && Number.isFinite(expectedHandleX)
  )
  const frameTimes = samples
    .map(({ delta }) => delta)
    .filter((delta) => Number.isFinite(delta) && delta >= 0)
  const pointerLag = samples.map(({ handleX, expectedHandleX }) =>
    Math.abs(handleX - expectedHandleX)
  )
  const gpuTasks = trace.traceEvents
    .filter(({ name, ph, dur }) => name === 'GPUTask' && ph === 'X' && Number.isFinite(dur))
    .map(({ dur }) => dur / 1_000)
  return {
    frames: frameTimes.length,
    p95Ms: percentile(frameTimes, 0.95),
    maxMs: Math.max(0, ...frameTimes),
    framesOver50: frameTimes.filter((duration) => duration > 50).length,
    p95PointerLagPx: percentile(pointerLag, 0.95),
    maxPointerLagPx: Math.max(0, ...pointerLag),
    maxGpuTaskMs: Math.max(0, ...gpuTasks),
    browserBoundsUpdates: trace.metadata.browserBoundsSamples?.length ?? 0
  }
}

function summarizeHover(trace) {
  const frameTimes = trace.metadata.frameTimes
    .map(({ delta }) => delta)
    .filter((delta) => Number.isFinite(delta) && delta >= 0)
  const gpuTasks = trace.traceEvents
    .filter(({ name, ph, dur }) => name === 'GPUTask' && ph === 'X' && Number.isFinite(dur))
    .map(({ dur }) => dur / 1_000)
  return {
    frames: frameTimes.length,
    p95Ms: percentile(frameTimes, 0.95),
    maxMs: Math.max(0, ...frameTimes),
    framesOver50: frameTimes.filter((duration) => duration > 50).length,
    p95PointerLagPx: 0,
    maxPointerLagPx: 0,
    maxGpuTaskMs: Math.max(0, ...gpuTasks),
    browserBoundsUpdates: trace.metadata.browserBoundsSamples?.length ?? 0
  }
}

function runTrace(target, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [traceScript], {
      env: {
        ...process.env,
        LARIFY_TRACE_ACTION: target === 'navigation-hover' ? 'hover-navigation' : 'resize-long',
        LARIFY_TRACE_CPU_PROFILE: '0',
        LARIFY_TRACE_OUTPUT: output,
        LARIFY_TRACE_RESIZE_STEPS: '180',
        LARIFY_TRACE_RESIZE_TARGET: target === 'navigation-hover' ? 'navigation' : target
      },
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${target} trace exited with code ${code}`))
    })
  })
}

function failures(result) {
  return Object.entries(limits).flatMap(([metric, maximum]) =>
    result[metric] > maximum ? [`${metric} ${result[metric].toFixed(1)} > ${maximum}`] : []
  )
}

const directory = await mkdtemp(join(tmpdir(), 'larify-startup-divider-performance-'))
try {
  const results = {}
  for (const target of ['navigation', 'workbench', 'navigation-hover']) {
    const output = join(directory, `${target}.json`)
    await runTrace(target, output)
    const trace = JSON.parse(await readFile(output, 'utf8'))
    if (trace.metadata.failure) throw new Error(`${target}: ${trace.metadata.failure}`)
    const tabs = trace.metadata.pageState?.workbenchTabs ?? []
    if (tabs.length > 0) {
      throw new Error(`Expected the startup workbench launcher, found ${tabs.length} open tab(s)`)
    }
    results[target] = target === 'navigation-hover' ? summarizeHover(trace) : summarize(trace)
  }

  console.log(JSON.stringify({ limits, results }, null, 2))
  const regressions = Object.entries(results).flatMap(([target, result]) => {
    const targetFailures = failures(result)
    return targetFailures.length > 0 ? [`${target}: ${targetFailures.join(', ')}`] : []
  })
  if (regressions.length > 0) throw new Error(regressions.join('; '))
} finally {
  await rm(directory, { force: true, recursive: true })
}
