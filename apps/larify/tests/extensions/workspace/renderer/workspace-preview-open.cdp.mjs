/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const app = await connectLarifyCdp()

try {
  await app.evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await wait(400)
  await app.evaluate(
    `Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === '文件')?.click()`
  )
  await wait(1200)

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const opened = await app.evaluate(`(() => {
      const node = Array.from(document.querySelectorAll('.rc-tree-node-content-wrapper'))
        .find((element) => element.textContent?.toLowerCase().endsWith('.pdf'))
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      return Boolean(node)
    })()`)
    if (opened) break
    await wait(200)
  }

  await wait(1500)
  console.log(
    await app.evaluate(`({
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((element) => element.textContent?.trim()),
    preview: (() => {
      const element = document.querySelector('[data-testid="native-file-preview"]')
      const rect = element?.getBoundingClientRect()
      return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })(),
    text: document.body.innerText.slice(-800)
  })`)
  )
} finally {
  app.close()
}
