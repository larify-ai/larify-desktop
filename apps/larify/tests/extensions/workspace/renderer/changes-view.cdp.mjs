/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const waitFor = async (expression, label, timeout = 5_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const session = '[data-workbench-session][data-active]'
const view = `${session} [data-workbench-view="changes"][data-active]`
const tree = `${view} .workspace-tree-scroll`
const layout = `${view} .workspace-layout`
const navigator = `${view} .workspace-layout-navigator`

const clickAria = (label) =>
  evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.click()`)
const switchSession = (title) =>
  evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button[data-session-id]')).find(
      (candidate) => candidate.textContent?.trim() === ${JSON.stringify(title)}
    )
    button?.click()
    return Boolean(button)
  })()`)
const openChanges = async () => {
  if (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(view)}))`))) {
    await evaluate(
      `document.querySelector(${JSON.stringify(`${session} .larify-workbench-home`)})?.click()`
    )
    await wait(100)
    const opened = await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(${JSON.stringify(`${session} button`)})).find(
        (candidate) =>
          candidate.textContent?.trim() === '变更' &&
          !candidate.classList.contains('larify-workbench-tab-trigger')
      )
      button?.click()
      return Boolean(button)
    })()`)
    if (!opened) throw new Error('Changes launcher not found')
  }
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(view)}))`, 'changes view')
  if (await evaluate(`Boolean(document.querySelector('[aria-label="显示工作台"]'))`)) {
    await clickAria('显示工作台')
    await waitFor(
      `document.querySelector(${JSON.stringify(view)})?.getBoundingClientRect().width > 500`,
      'visible workbench'
    )
  }
}

try {
  const workspaceSession = await switchSession('你可以使用终端么')
  if (!workspaceSession) throw new Error('Larify workspace session not found')
  await wait(300)
  await openChanges()
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)}))`,
    'initial diff'
  )
  if (
    (await evaluate(`Boolean(document.querySelector('[aria-label="显示变更目录树"]'))`)) &&
    !(await evaluate(`Boolean(document.querySelector(${JSON.stringify(`${layout}[data-constrained]`)}))`))
  ) {
    await clickAria('显示变更目录树')
    await waitFor(
      `document.querySelector(${JSON.stringify(navigator)})?.hasAttribute('data-open')`,
      'initial changes navigator'
    )
  }

  const initial = await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(view)})
    const tree = root?.querySelector('.workspace-tree-scroll')
    const preview = root?.querySelector('.workspace-file-preview')
    const nodes = Array.from(tree?.querySelectorAll('.rc-tree-treenode') ?? [])
    const directories = nodes.filter((node) => node.hasAttribute('aria-expanded'))
    const leaves = nodes.filter((node) => !node.hasAttribute('aria-expanded'))
    return {
      collapsedDirectories: directories.filter(
        (node) => node.getAttribute('aria-expanded') !== 'true'
      ).length,
      cursor: leaves[0] ? getComputedStyle(leaves[0]).cursor : null,
      directories: directories.length,
      leaves: leaves.length,
      mode: preview?.getAttribute('data-diff-mode'),
      navigatorOpen: root?.querySelector('.workspace-layout-navigator')?.hasAttribute('data-open'),
      selected: tree?.querySelectorAll('.rc-tree-treenode[aria-selected="true"]').length ?? 0
    }
  })()`)
  if (initial.leaves < 1) throw new Error(`No changed files: ${JSON.stringify(initial)}`)
  if (initial.collapsedDirectories !== 0) {
    throw new Error(`Changes tree is not fully expanded: ${JSON.stringify(initial)}`)
  }
  if (initial.cursor && !['auto', 'default'].includes(initial.cursor)) {
    throw new Error(`Unexpected changes tree cursor: ${initial.cursor}`)
  }
  if (initial.mode !== 'unified') {
    throw new Error(`Unexpected initial changes layout: ${JSON.stringify(initial)}`)
  }

  const selectedFile = await evaluate(`(() => {
    const leaves = Array.from(document.querySelectorAll(
      ${JSON.stringify(`${tree} .rc-tree-treenode:not([aria-expanded]) .rc-tree-node-content-wrapper`)}
    ))
    const target = leaves.find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight
    }) ?? leaves[0]
    if (!target) return null
    target.scrollIntoView({ block: 'center' })
    return target.querySelector('[title]')?.getAttribute('title') ?? null
  })()`)
  if (!selectedFile) throw new Error('Changed file could not be resolved')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'unified'`,
    'selected file diff'
  )
  const jsonTokenClasses = selectedFile.toLowerCase().endsWith('.json')
    ? await waitFor(
        `(() => {
          const classes = new Set(
            Array.from(document.querySelectorAll(${JSON.stringify(`${view} .view-lines span[class*="mtk"]`)}))
              .map((node) => node.className.match(/\\bmtk\\d+\\b/)?.[0])
              .filter(Boolean)
          )
          return classes.size >= 3 ? [...classes] : null
        })()`,
        'JSON syntax highlighting'
      )
    : []

  await clickAria('切换到拆分视图')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'split'`,
    'split diff'
  )
  const splitEditors = await evaluate(
    `document.querySelectorAll(${JSON.stringify(`${view} .monaco-diff-editor .editor.original, ${view} .monaco-diff-editor .editor.modified`)}).length`
  )
  if (splitEditors < 2) throw new Error(`Split diff editors missing: ${splitEditors}`)
  await clickAria('切换到统一视图')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'unified'`,
    'unified diff'
  )

  await clickAria('隐藏变更目录树')
  await waitFor(
    `Boolean(document.querySelector('[aria-label="显示变更目录树"]'))`,
    'changes navigator state close'
  )
  const closedLayout = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(layout)})
    const navigator = document.querySelector(${JSON.stringify(navigator)})
    return { inert: navigator?.inert, columns: getComputedStyle(element).gridTemplateColumns }
  })()`)
  if (!closedLayout.inert) throw new Error('Hidden changes navigator remains interactive')
  await clickAria('显示变更目录树')
  await waitFor(
    `Boolean(document.querySelector('[aria-label="隐藏变更目录树"]'))`,
    'changes navigator state reopen'
  )

  const drag = await evaluate(`(() => {
    const type = 'application/x-larify-workspace-entry'
    const read = (selector) => {
      const target = document.querySelector(selector)
      if (!target) return null
      const transfer = new DataTransfer()
      target.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
      return {
        draggable: target.getAttribute('draggable'),
        payload: JSON.parse(transfer.getData(type)),
        typePresent: transfer.types.includes(type)
      }
    }
    return {
      directory: read(${JSON.stringify(`${tree} .rc-tree-treenode[aria-expanded] [draggable="true"]`)}),
      file: read(${JSON.stringify(`${tree} .rc-tree-treenode:not([aria-expanded]) [draggable="true"]`)})
    }
  })()`)
  if (
    !drag?.file?.typePresent ||
    !drag.file.payload?.path ||
    !drag.file.payload?.name ||
    drag.file.payload.directory ||
    !drag.directory?.typePresent ||
    !drag.directory.payload?.path ||
    !drag.directory.payload?.name ||
    !drag.directory.payload.directory
  ) {
    throw new Error(`Workspace drag payload is invalid: ${JSON.stringify(drag)}`)
  }

  console.log(
    JSON.stringify(
      {
        closedLayout,
        drag,
        initial,
        jsonTokenClasses,
        selectedFile,
        splitEditors
      },
      null,
      2
    )
  )
} finally {
  cdp.close()
}
