/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'
import {
  activityHistorySessionId,
  createActivityHistorySession,
  removeActivityHistorySession
} from './activity-history-fixture.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)

const waitFor = async (expression, label, timeout = 30_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(100)
  }
  const diagnostic = await evaluate(`({
    text: document.body.innerText.slice(0, 1000),
    sessionIds: [...document.querySelectorAll('button[data-session-id]')]
      .map(({ dataset }) => dataset.sessionId),
    historyCount: document.querySelectorAll('[data-activity-history]').length
  })`)
  throw new Error(`Timed out: ${label}\n${JSON.stringify(diagnostic, null, 2)}`)
}

try {
  createActivityHistorySession()
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(
    `(async () => {
      const sessions = await window.bridge.invoke('session:list', '', 0, 50)
      return sessions.some(({ id }) => id === ${JSON.stringify(activityHistorySessionId)})
    })()`,
    'activity history fixture in session store'
  )
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button[data-session-id]')]
    const target = buttons.find(
      ({ dataset }) => dataset.sessionId === ${JSON.stringify(activityHistorySessionId)}
    )
    if (target?.getAttribute('aria-current') !== 'page') return
    buttons.find(({ dataset }) => dataset.sessionId !== ${JSON.stringify(activityHistorySessionId)})?.click()
  })()`)
  await wait(300)
  await waitFor(
    `(() => {
      const target = [...document.querySelectorAll('button[data-session-id]')]
        .find(({ dataset }) => dataset.sessionId === ${JSON.stringify(activityHistorySessionId)})
      if (!target) return false
      if (target.getAttribute('aria-current') === 'page') return true
      target.click()
      return false
    })()`,
    'activity history fixture session'
  )
  await waitFor(
    `(() => {
      const scroller = document.querySelector('[role="log"]')
      if (!scroller || !document.body.textContent?.includes('CDP 分页填充 47')) return false
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      return true
    })()`,
    'activity history top range'
  )
  const sectionTitles = await waitFor(
    `(() => {
      const scroller = document.querySelector('[role="log"]')
      if (scroller) {
        scroller.scrollTop = 0
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      }
      const history = document.querySelector('[data-activity-history]')
      const trigger = history?.querySelector(':scope > button')
      if (trigger?.getAttribute('data-state') === 'closed') trigger.click()
      const titles = [...(history?.querySelectorAll('[data-stage-status]') ?? [])]
        .map((icon) => icon.closest('[data-activity-group]')?.querySelector(':scope > button'))
        .filter(Boolean)
        .map((button) => button.textContent?.trim())
      return titles.length === 3 && titles[0] === '调研现有实现' ? titles : null
    })()`,
    'cross-page activity history sections'
  )
  assert.deepEqual(sectionTitles, ['调研现有实现', '实现并验证功能', '执行最终检查'])
  const spacing = await evaluate(`(() => {
    const history = document.querySelector('[data-activity-history]')
    const trigger = history?.querySelector(':scope > button')
    const stageButtons = [...(history?.querySelectorAll('[data-stage-status]') ?? [])]
      .map((icon) => icon.closest('[data-activity-group]')?.querySelector(':scope > button'))
      .filter(Boolean)
      .map((button) => button.getBoundingClientRect())
    return {
      titleToFirstStage: Math.round(
        stageButtons[0].top - trigger.getBoundingClientRect().bottom
      ),
      stageGaps: stageButtons.slice(1).map((rect, index) =>
        Math.round(rect.top - stageButtons[index].bottom)
      )
    }
  })()`)
  assert.deepEqual(spacing, {
    titleToFirstStage: 12,
    stageGaps: [12, 12]
  })
  const completedLayout = await evaluate(`(() => {
    const history = document.querySelector('[data-activity-history]')
    const content = history?.querySelector(':scope > [data-state="open"]:not(button)')
    return {
      completed: history?.querySelectorAll('[data-stage-status="completed"]').length,
      active: history?.querySelectorAll('[data-stage-status="active"]').length,
      indented: content?.classList.contains('pl-4'),
      dividerCount: [...(history?.querySelectorAll('.h-px') ?? [])].length
    }
  })()`)
  assert.deepEqual(completedLayout, {
    completed: 3,
    active: 0,
    indented: false,
    dividerCount: 1
  })

  await evaluate(`(() => {
    for (const button of document.querySelectorAll('[data-activity-group] > button')) button.click()
  })()`)
  const details = await evaluate(`document.querySelector('[role="log"]')?.textContent ?? ''`)
  assert.ok(details.includes('读取现有实现'))
  assert.ok(details.includes('修改功能实现'))
  assert.ok(details.includes('检查最终结果'))
  assert.ok(!details.includes('切换上下文'), 'reset tool should remain hidden')
  await waitFor(
    `(() => {
      const history = document.querySelector('[data-activity-history]')
      for (const button of history?.querySelectorAll('[data-activity-group] > button[data-state="closed"]') ?? []) {
        button.click()
      }
      return Boolean(history?.querySelector('[data-reasoning-content]'))
    })()`,
    'plain reasoning content'
  )
  const reasoningStyle = await evaluate(`(() => {
    const body = document.querySelector('[data-activity-history] [data-reasoning-content]')
    if (!body) return null
    const style = getComputedStyle(body)
    return { borderWidth: style.borderWidth, backgroundColor: style.backgroundColor }
  })()`)
  assert.notEqual(reasoningStyle?.borderWidth, '0px')
  assert.notEqual(reasoningStyle?.backgroundColor, 'rgba(0, 0, 0, 0)')

  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(
    `(() => {
      const button = [...document.querySelectorAll('button[data-session-id]')]
        .find(({ dataset }) => dataset.sessionId === ${JSON.stringify(activityHistorySessionId)})
      button?.click()
      return Boolean(button)
    })()`,
    'persisted activity history session'
  )
  const persistedCount = await waitFor(
    `(() => {
      const scroller = document.querySelector('[role="log"]')
      if (scroller) {
        scroller.scrollTop = 0
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      }
      return document.querySelectorAll('[data-activity-history]').length || null
    })()`,
    'persisted activity history'
  )
  assert.equal(persistedCount, 1)
  const changesCardCount = await waitFor(
    `(() => {
      const scroller = document.querySelector('[role="log"]')
      if (scroller) {
        scroller.scrollTop = 0
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      }
      return document.querySelectorAll('section[aria-label^="已编辑 "]').length || null
    })()`,
    'single cumulative changes card'
  )
  assert.equal(changesCardCount, 1)
  console.log(JSON.stringify({ persistedCount, sectionTitles, changesCardCount }, null, 2))
} finally {
  removeActivityHistorySession()
  cdp.close()
}
