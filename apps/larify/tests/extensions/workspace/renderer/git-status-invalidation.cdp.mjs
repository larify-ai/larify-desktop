/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const exec = promisify(execFile)
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const fixtureRoot = await mkdtemp(join(tmpdir(), 'larify-git-invalidation-'))
const nestedDirectory = join(fixtureRoot, 'deep', 'nested')
const fixtureFile = join(nestedDirectory, 'tracked.txt')
const port = process.env.LARIFY_CDP_PORT ?? '9222'
const app = await connectLarifyCdp(port)
let resourceId
let terminalId

async function git(...args) {
  await exec('git', args, { cwd: fixtureRoot })
}

async function waitFor(expression, message, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await app.evaluate(expression)) return
    await wait(50)
  }
  const diagnostics = await app.evaluate(`(() => ({
    activeChanges: document.querySelector('[data-workbench-view="changes"][data-active]')?.textContent,
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)
  }))()`)
  assert.fail(`${message}: ${JSON.stringify(diagnostics)}`)
}

const changesView = (id) => `[data-workbench-view="changes"][data-resource-id="${id}"]`

try {
  await app.send('Page.reload', { ignoreCache: true })
  await wait(1_200)
  await mkdir(nestedDirectory, { recursive: true })
  await writeFile(fixtureFile, 'initial\n')
  await git('init')
  await git('add', '.')
  await git(
    '-c',
    'user.name=Larify Test',
    '-c',
    'user.email=larify@example.test',
    'commit',
    '-m',
    'fixture'
  )

  const fixture = await app.evaluate(`(() => {
    const sessionId = document
      .querySelector('[data-workbench-session][data-active]')
      ?.getAttribute('data-workbench-session')
    if (!sessionId) throw new Error('active session is unavailable')
    const existing = Array.from(
      document.querySelectorAll('[data-workbench-view="changes"][data-resource-id]')
    ).map((view) => Number(view.getAttribute('data-resource-id')))
    window.dispatchEvent(new CustomEvent('larify:workbench-open', {
      detail: { rendererId: 'changes', options: { root: ${JSON.stringify(fixtureRoot)} } }
    }))
    return { existing, sessionId }
  })()`)
  await waitFor(
    `Array.from(document.querySelectorAll('[data-workbench-view="changes"][data-resource-id]')).some(
      (view) => !${JSON.stringify(fixture.existing)}.includes(Number(view.getAttribute('data-resource-id')))
    )`,
    'fixture Changes resource should open'
  )
  resourceId = await app.evaluate(`(() => {
    const existing = ${JSON.stringify(fixture.existing)}
    const view = Array.from(
      document.querySelectorAll('[data-workbench-view="changes"][data-resource-id]')
    ).find((candidate) => !existing.includes(Number(candidate.getAttribute('data-resource-id'))))
    return Number(view?.getAttribute('data-resource-id'))
  })()`)
  const view = changesView(resourceId)

  await waitFor(
    `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('暂无变更')`,
    'clean fixture should open with no changes'
  )

  await writeFile(fixtureFile, 'changed by card\n')
  await wait(650)
  assert.equal(
    await app.evaluate(
      `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('tracked.txt')`
    ),
    false,
    'the shallow explorer watcher should not discover an unopened deep file'
  )

  await app.evaluate(`window.dispatchEvent(new CustomEvent('larify:git-status-invalidate', {
    detail: { root: ${JSON.stringify(fixtureRoot)} }
  }))`)
  await waitFor(
    `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('tracked.txt')`,
    'change-card invalidation should refresh Git status'
  )

  await git('checkout', '--', 'deep/nested/tracked.txt')
  await app.evaluate(`window.dispatchEvent(new CustomEvent('larify:git-status-invalidate', {
    detail: { root: ${JSON.stringify(fixtureRoot)} }
  }))`)
  await waitFor(
    `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('暂无变更')`,
    'clean status should be restored'
  )

  const existingTerminals = await app.evaluate(`(() => {
    const existing = Array.from(
      document.querySelectorAll('[data-workbench-view="terminal"][data-resource-id]')
    ).map((view) => Number(view.getAttribute('data-resource-id')))
    window.dispatchEvent(new CustomEvent('larify:workbench-open', {
      detail: { rendererId: 'terminal', options: { cwd: ${JSON.stringify(fixtureRoot)} } }
    }))
    return existing
  })()`)
  await waitFor(
    `Array.from(document.querySelectorAll('[data-workbench-view="terminal"][data-resource-id]')).some(
      (view) => !${JSON.stringify(existingTerminals)}.includes(Number(view.getAttribute('data-resource-id')))
    )`,
    'fixture terminal should open'
  )
  terminalId = await app.evaluate(`(() => {
    const existing = ${JSON.stringify(existingTerminals)}
    const view = Array.from(
      document.querySelectorAll('[data-workbench-view="terminal"][data-resource-id]')
    ).find((candidate) => !existing.includes(Number(candidate.getAttribute('data-resource-id'))))
    return Number(view?.getAttribute('data-resource-id'))
  })()`)
  await waitFor(
    `(async () => (await window.bridge.invoke('terminal:getState', ${JSON.stringify(fixture.sessionId)}))
      .terminals.some((terminal) => terminal.id === ${terminalId} && terminal.shellIntegration))()`,
    'fixture terminal shell integration'
  )
  const terminalCommand = `Set-Content -LiteralPath '${fixtureFile.replaceAll("'", "''")}' -Value 'changed by terminal'\r`
  await app.evaluate(`window.bridge.invoke(
    'terminal:write',
    ${JSON.stringify(fixture.sessionId)},
    ${terminalId},
    ${JSON.stringify(terminalCommand)}
  )`)
  await waitFor(
    `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('tracked.txt')`,
    'terminal command completion should refresh Git status',
    10_000
  )

  await git('checkout', '--', 'deep/nested/tracked.txt')
  await app.evaluate(`window.dispatchEvent(new CustomEvent('larify:git-status-invalidate', {
    detail: { root: ${JSON.stringify(fixtureRoot)} }
  }))`)
  await waitFor(
    `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('暂无变更')`,
    'terminal change should be cleaned before focus fallback'
  )

  await writeFile(fixtureFile, 'changed before focus\n')
  await app.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(
    `document.querySelector(${JSON.stringify(view)})?.textContent?.includes('tracked.txt')`,
    'window focus should refresh Git status'
  )

  console.log(
    JSON.stringify(
      { fixtureRoot, focusFallback: true, invalidationRefresh: true, terminalRefresh: true },
      null,
      2
    )
  )
} finally {
  if (terminalId !== undefined) {
    await app
      .evaluate(`void window.bridge.invoke('resource:close', ${terminalId}); true`)
      .catch(() => undefined)
  }
  if (resourceId !== undefined) {
    await app
      .evaluate(`void window.bridge.invoke('resource:close', ${resourceId}); true`)
      .catch(() => undefined)
    await wait(250)
  }
  app.close()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(fixtureRoot, { recursive: true, force: true })
      break
    } catch {
      if (attempt === 4) break
      await wait(200)
    }
  }
}
