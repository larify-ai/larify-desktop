/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const app = await connectLarifyCdp()

if (process.env.APP_STATE) {
  console.log(
    await app.evaluate(`({
    labels: Array.from(document.querySelectorAll('button[aria-label]')).map((element) => element.getAttribute('aria-label')),
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((element) => element.textContent?.trim()),
    text: document.body.innerText.slice(0, 1000)
  })`)
  )
  app.close()
  process.exit(0)
}

if (process.env.EXPAND_WORKBENCH) {
  await app.evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await wait(500)
  console.log(await app.evaluate(`document.body.innerText.slice(-500)`))
  app.close()
  process.exit(0)
}

if (process.env.OPEN_WORKSPACE) {
  await app.evaluate(
    `Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === '文件')?.click()`
  )
  await wait(1000)
  console.log(
    await app.evaluate(
      `({ tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((element) => element.textContent?.trim()), text: document.body.innerText.slice(-500) })`
    )
  )
  app.close()
  process.exit(0)
}

const layoutSnapshot = () =>
  app.evaluate(`(() => {
    const preview = document.querySelector('[data-testid="native-file-preview"]')
    const pane = preview?.closest('.split-view-view')
    const navigator = document.querySelector('.workspace-layout-navigator')
    const rect = (element) => {
      const value = element?.getBoundingClientRect()
      return value && { x: value.x, y: value.y, width: value.width, height: value.height }
    }
    return { preview: rect(preview), pane: rect(pane), navigator: rect(navigator) }
  })()`)

const waitForPreview = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = await layoutSnapshot()
    if (snapshot.preview && snapshot.pane && snapshot.navigator) return snapshot
    await wait(100)
  }
  return layoutSnapshot()
}

const ensurePreview = async () => {
  let snapshot = await waitForPreview()
  if (snapshot.preview) return snapshot

  const opened = await app.evaluate(`(() => {
    const node = Array.from(document.querySelectorAll('.rc-tree-node-content-wrapper'))
      .find((element) => element.textContent?.toLowerCase().includes('.pdf'))
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    return Boolean(node)
  })()`)
  if (!opened) {
    throw new Error('Native preview is not open and no PDF entry is visible in the workspace tree')
  }

  snapshot = await waitForPreview()
  if (!snapshot.preview || !snapshot.pane || !snapshot.navigator) {
    throw new Error(`Native preview did not become ready: ${JSON.stringify(snapshot)}`)
  }
  return snapshot
}

if (process.env.OPEN_PDF) {
  await app.evaluate(
    `Array.from(document.querySelectorAll('.rc-tree-node-content-wrapper')).find((element) => element.textContent?.includes('.pdf'))?.click()`
  )
  await wait(1500)
  console.log(await layoutSnapshot())
  app.close()
  process.exit(0)
}

const dragSash = async (from, to) => {
  try {
    await app.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...from,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    await app.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...to,
      button: 'left',
      buttons: 1
    })
  } finally {
    await app
      .send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...to,
        button: 'left',
        buttons: 0,
        clickCount: 1
      })
      .catch(() => undefined)
  }
}

const dragSashContinuously = async (from, to, sample) => {
  try {
    await app.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...from,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    for (let step = 1; step <= 12; step += 1) {
      const point = {
        x: from.x + ((to.x - from.x) * step) / 12,
        y: from.y + ((to.y - from.y) * step) / 12
      }
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...point,
        button: 'left',
        buttons: 1
      })
      await wait(16)
      await sample(step)
    }
  } finally {
    await app
      .send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...to,
        button: 'left',
        buttons: 0,
        clickCount: 1
      })
      .catch(() => undefined)
  }
}

const assertSynchronized = (snapshot, navigatorWidth) => {
  if (!snapshot.preview || !snapshot.pane || !snapshot.navigator) {
    throw new Error(`Incomplete layout snapshot: ${JSON.stringify(snapshot)}`)
  }
  const navigatorWidthChanged = Math.abs(snapshot.navigator.width - navigatorWidth)
  const previewWidthError = Math.abs(
    snapshot.preview.width - (snapshot.pane.width - snapshot.navigator.width)
  )
  const previewLeftError = Math.abs(snapshot.preview.x - snapshot.pane.x)
  if (navigatorWidthChanged > 1) {
    throw new Error(`Navigator reacted to outer resize: ${navigatorWidthChanged}px`)
  }
  if (previewWidthError > 2) {
    throw new Error(
      `Native preview width is out of sync: ${previewWidthError}px ${JSON.stringify(snapshot)}`
    )
  }
  if (previewLeftError > 2) {
    throw new Error(`Native preview left edge is out of sync: ${previewLeftError}px`)
  }
}

let restore
try {
  const initial = await ensurePreview()
  const getOuterSash = async () => {
    const sashes =
      await app.evaluate(`Array.from(document.querySelectorAll('.sash')).map((element, index) => {
    const rect = element.getBoundingClientRect()
    return {
      index,
      workbench: element.parentElement?.parentElement?.classList.contains('larify-workbench-allotment') ?? false,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height, className: element.className
    }
  })`)
    const outer = sashes.find(
      ({ className, height, width, workbench }) =>
        workbench && height > 400 && width < 20 && !className.includes('sash-disabled')
    )
    if (!outer) throw new Error(`Outer workbench sash not found: ${JSON.stringify(sashes)}`)
    return { outer, sashes }
  }

  const { outer, sashes } = await getOuterSash()
  if (process.env.INSPECT_ONLY) {
    console.log(JSON.stringify(sashes, null, 2))
    process.exit(0)
  }
  const start = { x: outer.x + outer.width / 2, y: outer.y + outer.height / 2 }
  if (process.env.TARGET_WORKBENCH_WIDTH) {
    const windowWidth = await app.evaluate('window.innerWidth')
    const targetX = windowWidth - Number(process.env.TARGET_WORKBENCH_WIDTH)
    restore = async () => {
      const { outer: current } = await getOuterSash()
      await dragSash({ x: current.x + current.width / 2, y: current.y + current.height / 2 }, start)
    }
    await dragSash(start, { x: targetX, y: start.y })
    await wait(100)
    const after = await layoutSnapshot()
    const minimumPreviewWidth = 270
    const overlap = after.preview.x + after.preview.width - after.navigator.x
    if (after.preview.width < minimumPreviewWidth) {
      throw new Error(`Preview collapsed below its minimum: ${after.preview.width}px`)
    }
    if (overlap > 1) {
      throw new Error(`Preview overlaps navigator by ${overlap}px`)
    }
    console.log(
      JSON.stringify(
        { targetWorkbenchWidth: Number(process.env.TARGET_WORKBENCH_WIDTH), after },
        null,
        2
      )
    )
  } else {
    const direction = outer.className.includes('sash-maximum') ? -1 : 1
    const target = { x: start.x + direction * 96, y: start.y }
    const before = initial
    const started = performance.now()
    restore = async () => {
      const { outer: current } = await getOuterSash()
      await dragSash({ x: current.x + current.width / 2, y: current.y + current.height / 2 }, start)
    }
    const samples = []
    await dragSashContinuously(start, target, async (step) => {
      const snapshot = await layoutSnapshot()
      assertSynchronized(snapshot, before.navigator.width)
      samples.push({ step, ...snapshot })
    })
    await wait(100)
    const after = await layoutSnapshot()
    const duration = performance.now() - started
    const moved = Math.abs(after.pane.x - before.pane.x)
    if (moved < 50) throw new Error(`Workbench sash did not move enough: ${moved}px`)
    assertSynchronized(after, before.navigator.width)
    if (duration > 2000) throw new Error(`Native preview resize took ${duration.toFixed(0)}ms`)
    console.log(JSON.stringify({ outer, before, samples, after, duration }, null, 2))
  }
} finally {
  await restore?.().catch(() => undefined)
  await app
    .send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 0,
      y: 0,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
    .catch(() => undefined)
  app.close()
}
