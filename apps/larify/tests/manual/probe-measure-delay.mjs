/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const send = (method, params = {}, timeout = 6000) =>
  Promise.race([
    cdp.send(method, params),
    new Promise((resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout ${method}`)), timeout)
    )
  ])

// 页面内：记录最后一个 mouseover 时间；用 requestAnimationFrame 循环检测 diff 出现
const setupProbe = () =>
  evaluate(`(() => {
    window.__probe = { hoverAt: null, diffAt: null, stop: false }
    window.addEventListener('mouseover', (e) => { window.__probe.hoverAt = performance.now() }, { capture: true })
    const check = () => {
      if (document.querySelector('.larify-file-diff')) {
        if (!window.__probe.diffAt) window.__probe.diffAt = performance.now()
        window.__probe.stop = true
        return
      }
      if (!window.__probe.stop) requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
    return true
  })()`)

const moveCursorToRow = async () => {
  const diag = await evaluate(`(() => {
    const section = document.querySelector('section[aria-label^="已编辑 "]')
    if (!section) return { err: 'no section' }
    const rowBtn = [...section.querySelectorAll('button')].find((b) => b.querySelector('span.min-w-0.truncate'))
    if (!rowBtn) return { err: 'no row' }
    const r = rowBtn.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rowText: rowBtn.textContent.trim().slice(0, 20) }
  })()`)
  if (!diag || diag.err) throw new Error(JSON.stringify(diag))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await wait(30)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: diag.cx, y: diag.cy })
  return diag
}

try {
  await evaluate(`document.querySelector('section[aria-label^="已编辑 "]')?.scrollIntoView({ block: 'center' })`)
  await wait(500)
  // 确保页面干净无 diff
  await evaluate(`document.querySelector('.larify-file-diff')?.remove()`)
  await wait(50)
  await setupProbe()
  await wait(50)
  const diag = await moveCursorToRow()
  console.log('hover diag:', JSON.stringify(diag))
  await wait(2500)
  const result = await evaluate(`(() => ({ hoverAt: window.__probe?.hoverAt, diffAt: window.__probe?.diffAt, stop: window.__probe?.stop }))()`)
  const delta = result?.diffAt && result?.hoverAt ? Math.round(result.diffAt - result.hoverAt) : null
  console.log('measured hover->diff delay =', delta, 'ms')
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
