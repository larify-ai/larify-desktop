/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const wait = (d) => new Promise((r) => setTimeout(r, d))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const send = (method, params = {}, timeout = 6000) =>
  Promise.race([
    cdp.send(method, params),
    new Promise((resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout ${method}`)), timeout)
    )
  ])

const state = () =>
  evaluate(`(() => {
    const list = document.querySelector('[data-message-local-scroll]')
    const viewport = document.querySelector('[data-message-scroll-viewport]')
    return { listTop: list?.scrollTop, viewportTop: viewport?.scrollTop }
  })()`)

const getRowPoint = () =>
  evaluate(`(() => {
    const section = document.querySelector('section[aria-label^="已编辑 "]')
    const rowBtn = section && [...section.querySelectorAll('button')].find((b) => b.querySelector('span.min-w-0.truncate'))
    if (!rowBtn) return null
    const r = rowBtn.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)

const wheel = async (x, y, dY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dY })
}

try {
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button[data-session-id]')].find(x => x.textContent.trim() === '卡片滑动变历史')
    b?.click(); return Boolean(b)
  })()`)
  await wait(900)
  await evaluate(`document.querySelector('section[aria-label^="已编辑 "]')?.scrollIntoView({ block: 'center' })`)
  await wait(400)

  const pt = await getRowPoint()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
  await wait(50)

  // 把列表滚回顶部，再逐步测
  // 先确保列表在顶部 undefined? 列表无可滚到顶部 via scrollTop=0 手动设置
  await evaluate(`document.querySelector('[data-message-local-scroll]') && (document.querySelector('[data-message-local-scroll]').scrollTop = 0)`)
  await wait(50)
  const init = await state()
  console.log('init listTop=', init.listTop, 'viewportTop=', init.viewportTop)

  // 单次 wheel 60px，看是否传导 (列表 scrollable=28)
  await wheel(pt.x, pt.y, 60)
  await wait(50)
  const a = await state()
  const listDelta = a.listTop - init.listTop
  const viewportDelta = Math.round((a.viewportTop - init.viewportTop) * 10) / 10
  console.log(`wheel 60px: listDelta=${listDelta} viewportDelta=${viewportDelta} (listScrollable=28)`)

  // 单独测：列表已到底，单次 wheel 60px
  await evaluate(`document.querySelector('[data-message-local-scroll]').scrollTop = 28`)
  await wait(50)
  const b0 = await state()
  await wheel(pt.x, pt.y, 60)
  await wait(50)
  const b = await state()
  console.log(`bottom wheel 60px: listTop=${b.listTop} viewportDelta=${Math.round((b.viewportTop - b0.viewportTop) * 10) / 10}`)

  // 单独测：列表到顶，向上 wheel 60px
  await evaluate(`document.querySelector('[data-message-local-scroll]').scrollTop = 0`)
  await wait(50)
  const c0 = await state()
  await wheel(pt.x, pt.y, -60)
  await wait(50)
  const c = await state()
  console.log(`top wheel -60px: viewportDelta=${Math.round((c.viewportTop - c0.viewportTop) * 10) / 10}`)
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
