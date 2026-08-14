/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()

const evaluate = (expression) => cdp.evaluate(expression)

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

const drag = async (deltaX) => {
  const start = await point('.workspace-layout-navigator-handle')
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...start,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  for (let index = 1; index <= 8; index += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + (deltaX * index) / 8,
      y: start.y,
      button: 'left',
      buttons: 1
    })
    await wait(16)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: start.x + deltaX,
    y: start.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
  await wait(80)
}

const navigatorWidth = () =>
  evaluate(`document.querySelector('.workspace-navigator')?.getBoundingClientRect().width`)

const toggleSelector = '.larify-workbench-tab-actions button'

try {
  if (!(await evaluate(`Boolean(document.querySelector('.workspace-layout'))`))) {
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
    !(await evaluate(`Boolean(document.querySelector('.workspace-layout-navigator[data-open]'))`))
  ) {
    await click(toggleSelector)
    await wait(250)
  }

  const initialWidth = await navigatorWidth()
  if (initialWidth === undefined) throw new Error('Workspace navigator did not open')

  const scrollLayers = await evaluate(`(() => {
    const navigator = document.querySelector('.workspace-navigator')
    const tree = document.querySelector('.workspace-tree-scroll')
    return {
      navigator: navigator && getComputedStyle(navigator).overflow,
      tree: tree && getComputedStyle(tree).overflow
    }
  })()`)
  if (scrollLayers.navigator !== 'hidden' || scrollLayers.tree !== 'auto') {
    throw new Error(`Unexpected scroll layers: ${JSON.stringify(scrollLayers)}`)
  }

  await click(toggleSelector)
  await wait(250)
  const closedX = await evaluate(
    `document.querySelector('.workspace-navigator').getBoundingClientRect().x`
  )
  const layoutRight = await evaluate(
    `document.querySelector('.workspace-layout').getBoundingClientRect().right`
  )
  if (closedX < layoutRight) throw new Error('Navigator did not animate outside the layout')
  const closedTabIndex = await evaluate(
    `document.querySelector('.workspace-layout-navigator-handle').tabIndex`
  )
  if (closedTabIndex !== -1) throw new Error('Hidden navigator handle remains keyboard-focusable')
  const closedInert = await evaluate(`document.querySelector('.workspace-layout-navigator').inert`)
  if (!closedInert) throw new Error('Hidden navigator remains interactive')
  const hiddenNavigatorFocused = await evaluate(`(() => {
    const navigator = document.querySelector('.workspace-layout-navigator')
    const focusable = navigator.querySelector('[tabindex]')
    focusable?.focus()
    return navigator.contains(document.activeElement)
  })()`)
  if (hiddenNavigatorFocused) throw new Error('Hidden navigator accepted keyboard focus')

  await click(toggleSelector)
  await wait(250)
  const openTabIndex = await evaluate(
    `document.querySelector('.workspace-layout-navigator-handle').tabIndex`
  )
  if (openTabIndex !== 0) throw new Error('Visible navigator handle is not keyboard-focusable')
  const openInert = await evaluate(`document.querySelector('.workspace-layout-navigator').inert`)
  if (openInert) throw new Error('Visible navigator remains inert')
  const visibleHandleFocused = await evaluate(`(() => {
    const handle = document.querySelector('.workspace-layout-navigator-handle')
    handle.focus()
    return document.activeElement === handle
  })()`)
  if (!visibleHandleFocused) throw new Error('Visible navigator handle rejected keyboard focus')
  await drag(-80)
  const resizedWidth = await navigatorWidth()
  if (resizedWidth < initialWidth + 70) {
    throw new Error(`Navigator did not resize: ${initialWidth} -> ${resizedWidth}`)
  }

  await click(toggleSelector)
  await wait(250)
  await click(toggleSelector)
  await wait(250)
  const retainedWidth = await navigatorWidth()
  if (Math.abs(retainedWidth - resizedWidth) > 1) {
    throw new Error(`Navigator width was not retained: ${resizedWidth} -> ${retainedWidth}`)
  }

  await drag(500)
  const minimumWidth = await navigatorWidth()
  if (minimumWidth < 159 || minimumWidth > 161) {
    throw new Error(`Unexpected minimum navigator width: ${minimumWidth}`)
  }

  await drag(minimumWidth - initialWidth)
  console.log(JSON.stringify({ initialWidth, minimumWidth, retainedWidth, scrollLayers }, null, 2))
} finally {
  cdp.close()
}
