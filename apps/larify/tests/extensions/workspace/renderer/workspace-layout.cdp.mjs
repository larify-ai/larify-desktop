/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()

const evaluate = (expression) => cdp.evaluate(expression)
const waitFor = async (expression, label, timeout = 2_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(25)
  }
  throw new Error(`Timed out: ${label}`)
}

const point = (selector) =>
  evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error(${JSON.stringify(`${selector} not found`)})
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)

const click = async (selector) => {
  const position = await point(selector)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...position,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...position,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

const activeSessionSelector = '[data-workbench-session][data-active]'
const activeWorkbenchSelector = `${activeSessionSelector} [data-workbench-view="workspace"][data-active]`
const layoutSelector = `${activeWorkbenchSelector} .workspace-layout`
const navigatorContainerSelector = `${activeWorkbenchSelector} .workspace-layout-navigator`
const navigatorSelector = `${activeWorkbenchSelector} .workspace-navigator`
const handleSelector = `${activeWorkbenchSelector} .workspace-layout-navigator-handle`
const treeSelector = `${activeWorkbenchSelector} .workspace-tree-scroll`
const toggleSelector = `${activeSessionSelector} [data-workspace-navigator-toggle]`
const toggleNavigator = () =>
  evaluate(`document.querySelector(${JSON.stringify(toggleSelector)}).click()`)
const resizeNavigator = (key, count) =>
  evaluate(`(() => {
    const handle = document.querySelector(${JSON.stringify(handleSelector)})
    for (let index = 0; index < ${count}; index += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ${JSON.stringify(key)} }))
    }
  })()`)
const navigatorWidth = () =>
  evaluate(
    `document.querySelector(${JSON.stringify(navigatorSelector)})?.getBoundingClientRect().width`
  )

try {
  if (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(layoutSelector)}))`))) {
    await click('.larify-workbench-home')
    await wait(100)
    const fileCardIndex = await evaluate(`
      Array.from(document.querySelectorAll('button')).findIndex(
        (button) => button.textContent?.trim() === '\u6587\u4ef6'
      )
    `)
    if (fileCardIndex < 0) throw new Error('File launcher not found')
    await evaluate(`Array.from(document.querySelectorAll('button'))[${fileCardIndex}].click()`)
    await wait(800)
  }

  if (
    !(await evaluate(
      `Boolean(document.querySelector(${JSON.stringify(`${navigatorContainerSelector}[data-open]`)}))`
    ))
  ) {
    await toggleNavigator()
    await wait(250)
  }

  const initialWidth = await navigatorWidth()
  if (initialWidth === undefined) throw new Error('Workspace navigator did not open')

  const scrollLayers = await evaluate(`(() => {
    const navigator = document.querySelector(${JSON.stringify(navigatorSelector)})
    const tree = document.querySelector(${JSON.stringify(treeSelector)})
    return {
      navigator: navigator && getComputedStyle(navigator).overflow,
      tree: tree && getComputedStyle(tree).overflow
    }
  })()`)
  if (scrollLayers.navigator !== 'hidden' || scrollLayers.tree !== 'hidden') {
    throw new Error(`Unexpected scroll layers: ${JSON.stringify(scrollLayers)}`)
  }

  const scrollbars = await evaluate(`(() => {
    const tree = document.querySelector(${JSON.stringify(treeSelector)})
    const vertical = tree?.querySelector('.rc-tree-list-scrollbar-vertical')
    const horizontal = tree?.querySelector('.rc-tree-list-scrollbar-horizontal')
    const thumb = tree?.querySelector('.rc-tree-list-scrollbar-thumb')
    if (!vertical || !horizontal) {
      return {
        bothVisible: false,
        cursor: thumb && getComputedStyle(thumb).cursor,
        horizontal: Boolean(horizontal),
        nodes: tree?.querySelectorAll('.rc-tree-treenode').length,
        vertical: Boolean(vertical)
      }
    }
    const verticalRect = vertical.getBoundingClientRect()
    const horizontalRect = horizontal.getBoundingClientRect()
    return {
      bothVisible: true,
      cursor: thumb && getComputedStyle(thumb).cursor,
      overlaps:
        verticalRect.left < horizontalRect.right &&
        verticalRect.right > horizontalRect.left &&
        verticalRect.top < horizontalRect.bottom &&
        verticalRect.bottom > horizontalRect.top
    }
  })()`)
  if (scrollbars.cursor && scrollbars.cursor !== 'default') {
    throw new Error(`Unexpected workspace scrollbar cursor: ${scrollbars.cursor}`)
  }
  if (scrollbars.overlaps) throw new Error('Workspace scrollbars overlap')

  await toggleNavigator()
  await waitFor(
    `!document.querySelector(${JSON.stringify(navigatorContainerSelector)}).hasAttribute('data-open')`,
    'navigator close'
  )
  const closedTabIndex = await evaluate(
    `document.querySelector(${JSON.stringify(handleSelector)}).tabIndex`
  )
  if (closedTabIndex !== -1) throw new Error('Hidden navigator handle remains keyboard-focusable')
  const closedInert = await evaluate(
    `document.querySelector(${JSON.stringify(navigatorContainerSelector)}).inert`
  )
  if (!closedInert) throw new Error('Hidden navigator remains interactive')
  await toggleNavigator()
  await waitFor(
    `document.querySelector(${JSON.stringify(navigatorContainerSelector)}).hasAttribute('data-open')`,
    'navigator open'
  )
  const openTabIndex = await evaluate(
    `document.querySelector(${JSON.stringify(handleSelector)}).tabIndex`
  )
  if (openTabIndex !== 0) throw new Error('Visible navigator handle is not keyboard-focusable')
  const openInert = await evaluate(
    `document.querySelector(${JSON.stringify(navigatorContainerSelector)}).inert`
  )
  if (openInert) throw new Error('Visible navigator remains inert')
  await resizeNavigator('ArrowLeft', 8)
  const resizedWidth = await navigatorWidth()
  if (resizedWidth < initialWidth + 70) {
    throw new Error(`Navigator did not resize: ${initialWidth} -> ${resizedWidth}`)
  }

  await toggleNavigator()
  await wait(250)
  await toggleNavigator()
  await waitFor(
    `document.querySelector(${JSON.stringify(navigatorContainerSelector)}).hasAttribute('data-open')`,
    'navigator reopen'
  )
  const retainedWidth = await navigatorWidth()
  if (Math.abs(retainedWidth - resizedWidth) > 1) {
    throw new Error(`Navigator width was not retained: ${resizedWidth} -> ${retainedWidth}`)
  }

  const treeAlignment = await evaluate(`(() => {
    const navigator = document.querySelector(${JSON.stringify(navigatorSelector)})
    const node = document.querySelector(${JSON.stringify(`${treeSelector} .rc-tree-treenode`)})
    if (!navigator || !node) return null
    return {
      navigatorLeft: navigator.getBoundingClientRect().left,
      nodeLeft: node.getBoundingClientRect().left
    }
  })()`)
  if (!treeAlignment || treeAlignment.nodeLeft - treeAlignment.navigatorLeft > 32) {
    throw new Error(`Workspace tree is shifted horizontally: ${JSON.stringify(treeAlignment)}`)
  }

  await resizeNavigator('ArrowRight', 30)
  const minimumWidth = await navigatorWidth()
  if (minimumWidth < 159 || minimumWidth > 161) {
    throw new Error(`Unexpected minimum navigator width: ${minimumWidth}`)
  }

  for (let depth = 0; depth < 4; depth += 1) {
    const expanded = await evaluate(`(() => {
      const tree = document.querySelector(${JSON.stringify(treeSelector)})
      const node = tree?.querySelector('.rc-tree-treenode[aria-expanded="false"]')
      if (!node) return false
      node.querySelector('.rc-tree-node-content-wrapper')?.click()
      return true
    })()`)
    if (!expanded) break
    await wait(500)
  }
  const overflowScrollbars = await evaluate(`(() => {
    const tree = document.querySelector(${JSON.stringify(treeSelector)})
    const list = tree?.querySelector('.rc-tree-list')
    if (!list) return null
    let vertical = list.querySelector(':scope > .rc-tree-list-scrollbar-vertical')
    let horizontal = list.querySelector(':scope > .rc-tree-list-scrollbar-horizontal')
    const injected = []
    if (!horizontal) {
      horizontal = document.createElement('div')
      horizontal.className = 'rc-tree-list-scrollbar rc-tree-list-scrollbar-horizontal'
      horizontal.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:8px'
      list.append(horizontal)
      injected.push(horizontal)
    }
    if (!vertical) {
      vertical = document.createElement('div')
      vertical.className = 'rc-tree-list-scrollbar rc-tree-list-scrollbar-vertical'
      vertical.style.cssText = 'position:absolute;top:0;right:0;bottom:0;width:8px'
      list.append(vertical)
      injected.push(vertical)
    }
    const thumb = tree?.querySelector('.rc-tree-list-scrollbar-thumb')
    const verticalRect = vertical.getBoundingClientRect()
    const horizontalRect = horizontal.getBoundingClientRect()
    const result = {
      bothVisible: true,
      cursor: thumb && getComputedStyle(thumb).cursor,
      nodes: tree?.querySelectorAll('.rc-tree-treenode').length,
      overlaps:
        verticalRect.left < horizontalRect.right &&
        verticalRect.right > horizontalRect.left &&
        verticalRect.top < horizontalRect.bottom &&
        verticalRect.bottom > horizontalRect.top
    }
    injected.forEach((element) => element.remove())
    return result
  })()`)
  if (!overflowScrollbars?.bothVisible) throw new Error('Workspace scrollbar corner test failed')
  if (overflowScrollbars.cursor !== 'default') {
    throw new Error(`Unexpected workspace scrollbar cursor: ${overflowScrollbars.cursor}`)
  }
  if (overflowScrollbars.overlaps) throw new Error('Workspace scrollbars overlap')

  await resizeNavigator('ArrowLeft', Math.round((initialWidth - minimumWidth) / 10))
  console.log(
    JSON.stringify(
      {
        initialWidth,
        minimumWidth,
        retainedWidth,
        scrollLayers,
        scrollbars,
        overflowScrollbars,
        treeAlignment
      },
      null,
      2
    )
  )
} finally {
  cdp.close()
}
