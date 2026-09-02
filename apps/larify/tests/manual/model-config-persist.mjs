/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (expression, label, timeout = 10_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out: ${label}`)
}

const trigger = '[aria-label="配置模型和思考强度"]'
const menu = '[data-slot="dropdown-menu-content"]'

const visibleModel = () =>
  evaluate(`(() => {
    const b = Array.from(document.querySelectorAll(${JSON.stringify(trigger)})).find(
      (c) => c.getBoundingClientRect().width > 0
    )
    return b ? b.textContent?.trim() : null
  })()`)

const listSessions = () =>
  evaluate(`Array.from(document.querySelectorAll('[data-session-id]')).map((el) => ({
    id: el.getAttribute('data-session-id'),
    text: el.textContent?.trim().slice(0, 20)
  }))`)

const clickSessionById = (id) =>
  evaluate(`(() => {
    const el = document.querySelector('[data-session-id=${JSON.stringify(id)}]')
    if (!el) return false
    el.click()
    return true
  })()`)

const changeModel = async (label) => {
  await evaluate(`(() => {
    const b = Array.from(document.querySelectorAll(${JSON.stringify(trigger)})).find(
      (c) => c.getBoundingClientRect().width > 0
    )
    b?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
  })()`)
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(menu)}))`, 'menu opened')
  return evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('${menu} [role="menuitem"]')).find(
      (i) => i.textContent?.trim() === ${JSON.stringify(label)}
    )
    if (!item) return false
    item.click()
    return true
  })()`)
}

const assert = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) process.exitCode = 1
}

// 从 localStorage 汇总会话模型
const snapshot = () =>
  evaluate(`Object.fromEntries(
    Object.keys(localStorage)
      .filter((k) => k.startsWith('larify.modelConfig'))
      .map((k) => [k, localStorage.getItem(k)])
  )`)

try {
  console.log('=== 补充验收：全局默认联动 + 重开持久化 ===')

  // 拿到当前会话列表
  const sessions = await listSessions()
  console.log('会话:', JSON.stringify(sessions))
  const target = sessions[1] ?? sessions[0]
  assert(target, '有会话可测')

  // 1) 全局默认联动：改当前会话模型 → 全局 larify.modelConfig 更新为最近选择
  await clickSessionById(target.id)
  await wait(400)
  await changeModel('DeepSeek-V4-Pro')
  await wait(300)
  const snap1 = await snapshot()
  const globalKey = 'larify.modelConfig'
  assert(snap1[globalKey]?.includes('deepseek-v4-pro'), `全局默认已更新为最近选择(pro) ✓ -> ${snap1[globalKey]}`)
  assert(snap1[`larify.modelConfig.${target.id}`]?.includes('deepseek-v4-pro'), `会话固化为 pro ✓`)

  // 2) 重开持久化：reload 页面，会话重新挂载后仍显示固化模型
  const targetId = target.id
  await evaluate('location.reload()')
  // 等页面重新加载完成
  await wait(3000)
  // 重新点击该会话，看是否显示 Pro
  await waitFor(`Array.from(document.querySelectorAll('[data-session-id]')).length > 0`, 'reloaded sessions')
  await clickSessionById(targetId)
  await wait(500)
  const modelAfterReload = await visibleModel()
  console.log('reload 后该会话模型:', modelAfterReload)
  assert(modelAfterReload?.startsWith('DeepSeek-V4-Pro'), `重开后该会话仍显示 Pro ✓ (${modelAfterReload})`)
  const snap2 = await snapshot()
  console.log('reload 后 storage:', JSON.stringify(snap2, null, 2))
} finally {
  cdp.close()
}
