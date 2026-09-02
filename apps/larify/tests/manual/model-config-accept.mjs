/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (expression, label, timeout = 5_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
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

const storageKeys = () =>
  evaluate(`Object.fromEntries(
    Object.keys(localStorage)
      .filter((k) => k.startsWith('larify.modelConfig'))
      .map((k) => [k, localStorage.getItem(k)])
  )`)

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

try {
  console.log('=== 会话级模型配置验收（A/B 隔离交叉验证） ===')
  const sessions = await listSessions()
  console.log('会话列表:', JSON.stringify(sessions))
  assert(sessions.length >= 2, '存在至少 2 个会话')

  const A = sessions.find((s) => s.text.includes('hello')) // 会话 A
  const B = sessions.find((s) => s.text.includes('导航') || s.text.includes('帮助'))
  assert(A && B, '找到两个不同会话 A/B')
  console.log(`A=「${A.text}」(${A.id})  B=「${B.text}」(${B.id})`)

  // 1) 切到 A，改为 Pro
  await clickSessionById(A.id)
  await wait(400)
  await changeModel('DeepSeek-V4-Pro')
  await wait(300)
  const aStored = await evaluate(`localStorage.getItem('larify.modelConfig.${A.id}')`)
  assert(aStored?.includes('deepseek-v4-pro'), `A 固化 deepseek-v4-pro ✓ (${aStored})`)
  console.log('A 显示:', await visibleModel())

  // 2) 切到 B，改为 Flash
  await clickSessionById(B.id)
  await wait(400)
  await changeModel('DeepSeek-V4-Flash')
  await wait(300)
  const bStored = await evaluate(`localStorage.getItem('larify.modelConfig.${B.id}')`)
  assert(bStored?.includes('deepseek-v4-flash"'), `B 固化 deepseek-v4-flash ✓ (${bStored})`)
  console.log('B 显示:', await visibleModel())

  // 3) 切回 A → 应显示 Pro
  await clickSessionById(A.id)
  await wait(400)
  const aModel = await visibleModel()
  assert(aModel?.startsWith('DeepSeek-V4-Pro'), `切回 A 显示 Pro ✓ (${aModel})`)

  // 4) 切回 B → 应显示 Flash
  await clickSessionById(B.id)
  await wait(400)
  const bModel = await visibleModel()
  assert(bModel?.startsWith('DeepSeek-V4-Flash'), `切回 B 显示 Flash ✓ (${bModel})`)

  console.log('\nlocalStorage 最终:', JSON.stringify(await storageKeys(), null, 2))
  console.log('\n✅ 会话 A/B 模型互相独立、各自固化、回显正确')
} finally {
  cdp.close()
}
