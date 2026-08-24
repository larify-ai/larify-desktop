/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { connectLarifyCdp } from '../manual/cdp-client.mjs'

const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const run = (label, script, args = []) =>
  new Promise((resolve, reject) => {
    console.log(`\n[workbench-suite] ${label}`)
    const child = spawn(process.execPath, [script, ...args], {
      cwd: appRoot,
      env: process.env,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (${signal ?? `exit ${code}`})`))
    })
  })

const waitForRenderer = async () => {
  const cdp = await connectLarifyCdp()
  try {
    const started = Date.now()
    while (Date.now() - started < 15_000) {
      if (
        await cdp.evaluate(
          `Boolean(window.bridge && document.querySelector('[data-workbench-session][data-active]'))`
        )
      )
        return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('renderer did not become ready after reload')
  } finally {
    cdp.close()
  }
}

const unitTests = [
  'tests/renderer/app/workbench/workbench-shell.test.ts',
  'tests/extensions/browser/renderer/browser-view.test.ts',
  'tests/extensions/workspace/renderer/workspace-tree.test.ts',
  'tests/extensions/workspace/renderer/workspace-layout.test.ts',
  'tests/extensions/workspace/renderer/workspace-view.test.ts',
  'tests/extensions/workspace/renderer/file-preview.test.ts',
  'tests/extensions/workspace/renderer/monaco-diff.test.ts',
  'tests/extensions/workspace/renderer/changes-view.test.ts',
  'tests/extensions/workspace/renderer/use-workspace-explorer.test.ts',
  'tests/extensions/workspace/renderer/use-git-decorations.test.ts',
  'tests/extensions/terminal/renderer/terminal-view.test.ts'
]

const cdpFeatureTests = [
  [
    'Workspace file preview',
    'tests/extensions/workspace/renderer/workspace-preview-performance.cdp.mjs'
  ],
  ['Workspace layout', 'tests/extensions/workspace/renderer/workspace-layout.cdp.mjs'],
  ['Changes view', 'tests/extensions/workspace/renderer/changes-view.cdp.mjs'],
  ['Workbench lifecycle', 'tests/renderer/app/workbench/workbench-lifecycle.cdp.mjs'],
  ['Terminal workbench', 'tests/extensions/terminal/terminal-workbench.cdp.mjs'],
  ['Browser workbench', 'tests/extensions/browser/browser-workbench.cdp.mjs'],
  ['20-tab mixed workbench', 'tests/performance/workbench-mixed-tabs.cdp.mjs']
]

try {
  if (process.env.LARIFY_SUITE_SKIP_STATIC !== '1') {
    await run('Focused unit and integration tests', 'node_modules/vitest/vitest.mjs', [
      'run',
      ...unitTests
    ])
    await run('Web typecheck', 'node_modules/typescript/bin/tsc', [
      '--noEmit',
      '-p',
      'tsconfig.web.json'
    ])
    await run('Focused lint', 'node_modules/eslint/bin/eslint.js', [
      ...unitTests,
      ...cdpFeatureTests.map(([, script]) => script),
      'tests/performance/workbench-performance-suite.mjs'
    ])
  }

  for (const [label, script] of cdpFeatureTests) {
    await waitForRenderer()
    await run(label, script)
  }

  console.log('\n[workbench-suite] PASS: workbench functional and performance gates passed')
} catch (error) {
  console.error(`\n[workbench-suite] FAIL: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
