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

const snap = () =>
  evaluate(`(() => {
    const list = document.querySelector('[data-message-local-scroll]')
    const viewport = document.querySelector('[data-message-scroll-viewport]')
    const diff = document.querySelector('.larify-file-diff')
    const diffBox = diff?.querySelector('.max-h-72')
    return {
      listScrollTop: list?.scrollTop ?? null,
      listScrollH: list?.scrollHeight ?? null,
      listClientH: list?.clientHeight ?? null,
      viewportScrollTop: viewport?.scrollTop ?? null,
      diffExists: Boolean(diff),
      diffOverscroll: diffBox ? getComputedStyle(diffBox).overscrollBehaviorY : null
    }
  })()`)

const mouseWheel = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
}

const getRowPoint = () =>
  evaluate(`(() => {
    const section = document.querySelector('section[aria-label^="已编辑 "]')
    if (!section) return null
    const rowBtn = [...section.querySelectorAll('button')].find((b) => b.querySelector('span.min-w-0.truncate'))
    if (!rowBtn) return null
    const r = rowBtn.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)

const getDiffContentPoint = () =>
  evaluate(`(() => {
    const box = document.querySelector('.larify-file-diff .max-h-72')
    if (!box) return null
    const r = box.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)

try {
  // 打开"卡片滑动变历史"会话
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button[data-session-id]')].find(x => x.textContent.trim() === '卡片滑动变历史')
    b?.click(); return Boolean(b)
  })()`)
  await wait(900)
  await evaluate(`document.querySelector('section[aria-label^="已编辑 "]')?.scrollIntoView({ block: 'center' })`)
  await wait(400)

  console.log('=== [1] 内部列表滚动链 (6文件, 有滚动条) ===')
  const s1 = await snap()
  const rowPt = await getRowPoint()
  if (!rowPt) throw new Error('no row point')
  // 鼠标放到文件行上，滚轮向下
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowPt.x, y: rowPt.y })
  await wait(50)
  await mouseWheel(rowPt.x, rowPt.y, 120)
  await wait(50)
  const s2 = await snap()
  console.log('before:', JSON.stringify({ listTop: s1.listScrollTop, viewportTop: s1.viewportScrollTop, listScrollH: s1.listScrollH, listClientH: s1.listClientH }))
  console.log('after wheel down:', JSON.stringify({ listTop: s2.listScrollTop, viewportTop: s2.viewportScrollTop }))
  console.log('=> listScrolled:', s2.listScrollTop > 0, 'viewportChanged:', s2.viewportScrollTop !== s1.viewportScrollTop)

  console.log('=== [2] diff 内容区 overscroll-behavior ===')
  // hover 第一行弹出 diff
  const rowPt2 = await getRowPoint()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowPt2.x, y: rowPt2.y })
  await wait(600)
  const s3 = await snap()
  console.log('diff exists:', s3.diffExists, 'diffOverscroll:', s3.diffOverscroll)

  console.log('=== [3] hover 延迟精确测量 (页面内 performance.now) ===')
  // 先在页面内清掉 diff、挂 mouseover 记录 + rAF 检测
  await evaluate(`(() => {
    document.querySelector('.larify-file-diff')?.remove()
    window.__p = { hoverAt: null, diffAt: null, stop: false }
    window.addEventListener('mouseover', (e) => { window.__p.hoverAt = performance.now() }, { capture: true })
    const check = () => {
      if (document.querySelector('.larify-file-diff')) { if (!window.__p.diffAt) window.__p.diffAt = performance.now(); window.__p.stop = true; return }
      if (!window.__p.stop) requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
    return true
  })()`)
  // 移到空白，等 hover 初始
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
  await wait(700)
  // hover 行（记录最后一次 mouseover 即此行）
  const rowPt3 = await getRowPoint()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
  await wait(30)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowPt3.x, y: rowPt3.y })
  await wait(900)
  const r = await evaluate(`(() => ({ hoverAt: window.__p?.hoverAt, diffAt: window.__p?.diffAt }))()`)
  const delay = r?.diffAt && r?.hoverAt ? Math.round(r.diffAt - r.hoverAt) : null
  console.log('measured hover->diff delay =', delay, 'ms (expect ~200ms)')
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
