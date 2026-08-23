/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createStressSession,
  removeStressSession,
  stressSessionId,
  stressSessionTitle
} from './layout-stress-fixture.mjs'

const traceScript = fileURLToPath(new URL('./layout-resize-trace.cdp.mjs', import.meta.url))
const syntheticMessageCount = Number(process.env.LARIFY_PERF_MESSAGE_COUNT ?? 2_000)
const browserTabCount = Number(process.env.LARIFY_PERF_BROWSER_TAB_COUNT ?? 9)
const workbenchTabCount = browserTabCount + 3
const desktopCwd = process.env.LARIFY_PERF_CWD ?? `${process.env.USERPROFILE}\\Desktop`
const heavyBrowserUrls = [
  'https://en.wikipedia.org/wiki/Electron_(software_framework)',
  'https://en.wikipedia.org/wiki/Chromium_(web_browser)',
  'https://en.wikipedia.org/wiki/React_(software)',
  'https://en.wikipedia.org/wiki/TypeScript',
  'https://en.wikipedia.org/wiki/JavaScript',
  'https://en.wikipedia.org/wiki/Windows_11',
  'https://en.wikipedia.org/wiki/Git',
  'https://en.wikipedia.org/wiki/Visual_Studio_Code'
]
const limits = {
  p95Ms: 40,
  maxMs: 100,
  framesOver50: 3,
  maxGpuTaskMs: 50,
  maxRenderedMessages: 80,
  maxDomNodes: 2_500
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function frameSummary(samples) {
  const frameTimes = samples
    .map(({ delta }) => delta)
    .filter((delta) => Number.isFinite(delta) && delta >= 0)
  return {
    frames: frameTimes.length,
    p95Ms: percentile(frameTimes, 0.95),
    maxMs: Math.max(0, ...frameTimes),
    framesOver50: frameTimes.filter((duration) => duration > 50).length
  }
}

function summarize(trace) {
  const phases = Object.fromEntries(
    [...new Set(trace.metadata.frameTimes.map(({ phase }) => phase).filter(Boolean))].map(
      (phase) => [
        phase,
        frameSummary(trace.metadata.frameTimes.filter((sample) => sample.phase === phase))
      ]
    )
  )
  const gpuTasks = trace.traceEvents
    .filter(({ name, ph, dur }) => name === 'GPUTask' && ph === 'X' && Number.isFinite(dur))
    .map(({ dur }) => dur / 1_000)
  return {
    phases,
    maxGpuTaskMs: Math.max(0, ...gpuTasks),
    renderedMessages: trace.metadata.finalPageState?.renderedMessages?.length ?? 0,
    domNodes: trace.metadata.pageState?.domNodeCount ?? 0,
    workbenchTabs: trace.metadata.pageState?.workbenchTabs?.length ?? 0,
    workbenchRenderers: [
      ...new Set(
        (trace.metadata.pageState?.workbenchViews ?? [])
          .map(({ renderer }) => renderer)
          .filter(Boolean)
      )
    ],
    hiddenWorkbenchViews: trace.metadata.pageState?.hiddenWorkbenchViewCount ?? 0,
    browserBoundsUpdates: trace.metadata.browserBoundsSamples?.length ?? 0,
    stressCoverage: trace.metadata.stressCoverage
  }
}

function runTrace(output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [traceScript], {
      env: {
        ...process.env,
        LARIFY_TRACE_ACTION: 'stress-suite',
        LARIFY_TRACE_DISABLED: '1',
        LARIFY_TRACE_OUTPUT: output,
        LARIFY_TRACE_RESIZE_STEPS: '180',
        LARIFY_TRACE_RELOAD: '1',
        LARIFY_TRACE_THREAD: stressSessionTitle,
        LARIFY_TRACE_STRESS_SESSION_ID: stressSessionId,
        LARIFY_TRACE_WORKBENCH_RENDERER: 'browser',
        LARIFY_TRACE_WORKBENCH_TAB_COUNT: String(browserTabCount),
        LARIFY_TRACE_WORKBENCH_FEATURE_TABS: '1',
        LARIFY_TRACE_WORKBENCH_CWD: desktopCwd,
        LARIFY_TRACE_BROWSER_URL: 'https://www.xiaohongshu.com/explore',
        LARIFY_TRACE_BROWSER_URLS: JSON.stringify(heavyBrowserUrls)
      },
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`stress trace exited with code ${code}`))
    })
  })
}

function leaveStressSession(output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [traceScript], {
      env: {
        ...process.env,
        LARIFY_TRACE_CLEANUP_STRESS_ONLY: '1',
        LARIFY_TRACE_OUTPUT: output
      },
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`stress cleanup exited with code ${code}`))
    })
  })
}

const directory = await mkdtemp(join(tmpdir(), 'larify-layout-stress-performance-'))
try {
  createStressSession({ cwd: desktopCwd, messageCount: syntheticMessageCount })
  const output = join(directory, 'combined-stress.json')
  await runTrace(output)
  const trace = JSON.parse(await readFile(output, 'utf8'))
  if (trace.metadata.failure) throw new Error(trace.metadata.failure)
  const result = summarize(trace)
  console.log(
    JSON.stringify(
      {
        limits,
        stress: { syntheticMessageCount, browserTabCount, workbenchTabCount, cwd: desktopCwd },
        result
      },
      null,
      2
    )
  )

  const failures = []
  if (result.workbenchTabs < workbenchTabCount) {
    failures.push(`workbenchTabs ${result.workbenchTabs} < ${workbenchTabCount}`)
  }
  if ((result.stressCoverage?.toggleCount ?? 0) < 1) failures.push('no toggle controls exercised')
  if ((result.stressCoverage?.scrollableCount ?? 0) < 2) {
    failures.push(
      `only ${result.stressCoverage?.scrollableCount ?? 0} scrollable regions exercised`
    )
  }
  if ((result.stressCoverage?.browserScrollableCount ?? 0) < browserTabCount) {
    failures.push(
      `only ${result.stressCoverage?.browserScrollableCount ?? 0} browser pages scrolled`
    )
  }
  if ((result.stressCoverage?.browserScrollFailures?.length ?? 0) > 0) {
    failures.push(
      `${result.stressCoverage.browserScrollFailures.length} browser pages failed to scroll`
    )
  }
  for (const renderer of ['browser', 'workspace', 'changes', 'terminal']) {
    if (!result.workbenchRenderers.includes(renderer)) failures.push(`${renderer} view not mounted`)
  }
  for (const [phase, metrics] of Object.entries(result.phases)) {
    if (metrics.p95Ms > limits.p95Ms) failures.push(`${phase}: p95 ${metrics.p95Ms.toFixed(1)}ms`)
    if (metrics.maxMs > limits.maxMs) failures.push(`${phase}: max ${metrics.maxMs.toFixed(1)}ms`)
    if (metrics.framesOver50 > limits.framesOver50) {
      failures.push(`${phase}: ${metrics.framesOver50} frames over 50ms`)
    }
  }
  if (result.maxGpuTaskMs > limits.maxGpuTaskMs) {
    failures.push(`max GPU task ${result.maxGpuTaskMs.toFixed(1)}ms`)
  }
  if (result.renderedMessages > limits.maxRenderedMessages) {
    failures.push(`rendered messages ${result.renderedMessages}`)
  }
  if (result.domNodes > limits.maxDomNodes) failures.push(`DOM nodes ${result.domNodes}`)
  if (failures.length > 0) throw new Error(failures.join('; '))
} finally {
  await leaveStressSession(join(directory, 'cleanup.json')).catch(() => undefined)
  removeStressSession()
  await rm(directory, { recursive: true, force: true })
}
