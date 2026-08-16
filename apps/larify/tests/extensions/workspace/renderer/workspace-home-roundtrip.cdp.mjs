/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const app = await connectLarifyCdp()
const snapshot = () =>
  app.evaluate(`(() => {
    const preview = document.querySelector('[data-testid="native-file-preview"]')
    const pane = preview?.closest('.split-view-view')
    const rect = (element) => {
      const value = element?.getBoundingClientRect()
      return value && { x: value.x, width: value.width }
    }
    return { preview: rect(preview), pane: rect(pane) }
  })()`)

try {
  const before = await snapshot()
  await app.evaluate(`document.querySelector('button[aria-label="工作台首页"]')?.click()`)
  await wait(200)
  const home = await snapshot()
  await app.evaluate(
    `Array.from(document.querySelectorAll('[role="tab"]')).find((element) => element.textContent?.includes('.pdf'))?.click()`
  )
  const samples = []
  for (let index = 0; index < 24; index += 1) {
    samples.push(await snapshot())
    await wait(16)
  }
  const targets = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
  const pdfPages = targets.filter(({ type, url }) => type === 'page' && url.endsWith('.pdf')).length
  console.log(JSON.stringify({ before, home, samples, pdfPages }, null, 2))
} finally {
  app.close()
}
