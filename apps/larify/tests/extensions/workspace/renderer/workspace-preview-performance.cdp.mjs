/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()

try {
  if (process.env.COLD === '1') {
    await cdp.send('Page.reload', { ignoreCache: true })
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (
        await cdp.evaluate(
          `Boolean(document.querySelector('[data-workbench-session][data-active] .workspace-tree-scroll'))`
        )
      ) {
        break
      }
      await wait(25)
    }
  }

  if (
    !(await cdp.evaluate(
      `Boolean(document.querySelector('[data-workbench-session][data-active] .workspace-tree-scroll'))`
    ))
  ) {
    await cdp.evaluate(`document.querySelector('.larify-workbench-home')?.click()`)
    await wait(50)
    await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '\u6587\u4ef6'
    )?.click()`)
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (
        await cdp.evaluate(
          `Boolean(document.querySelector('[data-workbench-session][data-active] .workspace-tree-scroll'))`
        )
      ) {
        break
      }
      await wait(25)
    }
  }

  for (let depth = 0; depth < 4; depth += 1) {
    const hasFile = await cdp.evaluate(
      `/\\.(?:css|html|js|json|md|mjs|ts|tsx|txt)$/i.test(document.querySelector('[data-workbench-session][data-active] .workspace-tree-scroll')?.textContent ?? '')`
    )
    if (hasFile) break
    const expanded = await cdp.evaluate(`(() => {
      const node = document.querySelector(
        '[data-workbench-session][data-active] .workspace-tree-scroll .rc-tree-treenode[aria-expanded="false"]'
      )
      node?.querySelector('.rc-tree-node-content-wrapper')?.click()
      return Boolean(node)
    })()`)
    if (!expanded) break
    await wait(100)
  }

  const target = await cdp.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(
      '[data-workbench-session][data-active] .workspace-tree-scroll .rc-tree-treenode'
    ))
    const leaf = nodes.find(
      (node) =>
        !node.hasAttribute('aria-expanded') &&
        /\\.(?:css|html|js|json|md|mjs|ts|tsx|txt)$/i.test(node.textContent ?? '')
    )
    if (!leaf) return null
    window.__workspacePreviewProbe = { start: performance.now(), name: leaf.textContent?.trim() }
    leaf.querySelector('.rc-tree-node-content-wrapper')?.click()
    return window.__workspacePreviewProbe
  })()`)
  if (!target) {
    const tree = await cdp.evaluate(
      `document.querySelector('[data-workbench-session][data-active] .workspace-tree-scroll')?.textContent`
    )
    throw new Error(`No visible workspace file found: ${tree}`)
  }

  const phases = {}
  let result
  for (let attempt = 0; attempt < 400; attempt += 1) {
    result = await cdp.evaluate(`(() => {
      const probe = window.__workspacePreviewProbe
      return {
        elapsed: performance.now() - probe.start,
        loading: Array.from(document.querySelectorAll('[role="status"], div')).some(
          (element) => element.textContent?.includes('\u6b63\u5728\u6253\u5f00\u6587\u4ef6')
        ),
        lines: document.querySelectorAll('.monaco-editor .view-line').length,
        monaco: Boolean(document.querySelector('.monaco-editor'))
      }
    })()`)
    if (result.loading && phases.loading === undefined) phases.loading = result.elapsed
    if (result.monaco && phases.monaco === undefined) phases.monaco = result.elapsed
    if (result.lines > 0 && phases.content === undefined) phases.content = result.elapsed
    if (result.monaco && result.lines > 0) break
    await wait(10)
  }

  let tokenColors = []
  for (let attempt = 0; attempt < 200; attempt += 1) {
    tokenColors = await cdp.evaluate(`Array.from(
      new Set(Array.from(document.querySelectorAll('.monaco-editor .view-line span')).map(
        (element) => getComputedStyle(element).color
      ))
    )`)
    if (tokenColors.length >= 2) break
    await wait(10)
  }
  if (tokenColors.length < 2) {
    const tokenDiagnostics = await cdp.evaluate(`({
      probe: window.__workspacePreviewProbe,
      text: document.querySelector('.monaco-editor .view-lines')?.textContent,
      tokens: Array.from(document.querySelectorAll('.monaco-editor .view-line span'))
        .slice(0, 20)
        .map((element) => ({ className: element.className, text: element.textContent }))
    })`)
    throw new Error(`Monaco syntax highlighting is not active: ${JSON.stringify(tokenDiagnostics)}`)
  }

  const alignment = await cdp.evaluate(`(() => {
    const home = document.querySelector('.larify-workbench-home svg')
    const lineNumber = document.querySelector('.monaco-editor .line-numbers')
    const rect = (element) => element && {
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: element.getBoundingClientRect().width
    }
    return {
      home: rect(home),
      lineNumber: rect(lineNumber),
      lineNumberStyle: lineNumber && {
        paddingLeft: getComputedStyle(lineNumber).paddingLeft,
        paddingRight: getComputedStyle(lineNumber).paddingRight,
        textAlign: getComputedStyle(lineNumber).textAlign
      }
    }
  })()`)

  console.log(JSON.stringify({ alignment, phases, result, target, tokenColors }, null, 2))
} finally {
  cdp.close()
}
