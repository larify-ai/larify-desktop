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

const listState = () =>
  evaluate(`(() => {
    const list = document.querySelector('[data-message-local-scroll]')
    const viewport = document.querySelector('[data-message-scroll-viewport]')
    return {
      listTop: list?.scrollTop ?? null,
      listScrollH: list?.scrollHeight ?? null,
      listClientH: list?.clientHeight ?? null,
      listOverscrollY: list ? getComputedStyle(list).overscrollBehaviorY : null,
      viewportTop: viewport?.scrollTop ?? null
    }
  })()`)

const getRowPoint = () =>
  evaluate(`(() => {
    const section = document.querySelector('section[aria-label^="已编辑 "]')
    if (!section) return null
    const rowBtn = [...section.querySelectorAll('button')].find((b) => b.querySelector('span.min-w-0.truncate'))
    if (!rowBtn) return null
    const r = rowBtn.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)

const mouseWheel = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
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

  const s0 = await listState()
  console.log('list overscrollY =', s0.listOverscrollY, '| scrollable =', s0.listScrollH - s0.listClientH)

  // 从列表顶部开始，连续向下滚到底
  console.log('--- 连续向下滚 (从顶部) ---')
  let prevTop = s0.listTop
  for (let i = 0; i < 10; i++) {
    await mouseWheel(pt.x, pt.y, 60)
    await wait(20)
    const s = await listState()
    console.log(`wheel#${i}: listTop=${s.listTop} viewportTop=${s.viewportTop}`)
    if (s.listTop === prevTop && s.listTop >= (s.listScrollH - s.listClientH)) break
    prevTop = s.listTop
  }
  // 到底后额外向下滚
  const sBottom = await listState()
  console.log('at bottom:', JSON.stringify(sBottom))
  await mouseWheel(pt.x, pt.y, 60)
  await wait(20)
  const sAfterBottom = await listState()
  console.log('extra wheel down at bottom: listTop=', sAfterBottom.listTop, 'viewportTop=', sAfterBottom.viewportTop, '| viewport moved:', sAfterBottom.viewportTop !== sBottom.viewportTop)
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
