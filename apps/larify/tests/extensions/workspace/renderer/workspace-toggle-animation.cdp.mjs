/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const app = await connectLarifyCdp()

const sampleToggle = (label) =>
  app.evaluate(`new Promise((resolve) => {
    const button = document.querySelector('button[aria-label="${label}"]')
    if (!button) return resolve({ error: 'button not found', label: '${label}' })
    const samples = []
    const started = performance.now()
    button.click()
    const capture = () => {
      const preview = document.querySelector('[data-testid="native-file-preview"]')
      const wrapper = preview?.parentElement
      const content = document.querySelector('.workspace-layout-content')
      const navigator = document.querySelector('.workspace-layout-navigator')
      const pane = preview?.closest('.split-view-view')
      const rect = (element) => {
        const value = element?.getBoundingClientRect()
        return value && {
          x: Math.round(value.x * 10) / 10,
          width: Math.round(value.width * 10) / 10
        }
      }
      samples.push({
        t: Math.round(performance.now() - started),
        preview: rect(preview),
        wrapper: rect(wrapper),
        content: rect(content),
        navigator: rect(navigator),
        pane: rect(pane),
        animating: wrapper?.hasAttribute('data-preview-animating') ?? false
      })
      if (performance.now() - started < 360) requestAnimationFrame(capture)
      else resolve(samples)
    }
    requestAnimationFrame(capture)
  })`)

try {
  const hidden = await sampleToggle('隐藏工作台')
  const shown = await sampleToggle('显示工作台')
  console.log(JSON.stringify({ hidden, shown }, null, 2))
} finally {
  app.close()
}
