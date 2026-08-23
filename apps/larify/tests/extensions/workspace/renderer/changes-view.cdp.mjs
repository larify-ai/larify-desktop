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
  evaluate(
    `(document.querySelector(${JSON.stringify(`${session} [aria-label="${label}"]`)}) ?? document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}))?.click()`
  )
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
  const workspaceSession =
    (await switchSession('您能编辑一些文件我看看么')) ||
    (await evaluate(`Boolean(document.querySelector(${JSON.stringify(session)}))`))
  if (!workspaceSession) throw new Error('Larify workspace session not found')
  await wait(300)
  await openChanges()
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)}))`,
    'initial diff'
  )
  if (
    await evaluate(
      `Boolean(document.querySelector(${JSON.stringify(`${session} [aria-label="切换到统一视图"]`)}))`
    )
  ) {
    await clickAria('切换到统一视图')
    await waitFor(
      `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'unified'`,
      'initial unified diff'
    )
  }
  if (
    (await evaluate(
      `Boolean(document.querySelector(${JSON.stringify(`${session} [aria-label="显示变更目录树"]`)}))`
    )) &&
    !(await evaluate(
      `Boolean(document.querySelector(${JSON.stringify(`${layout}[data-constrained]`)}))`
    ))
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
      selected: tree?.querySelectorAll('.rc-tree-treenode[aria-selected="true"]').length ?? 0,
      visibleLightbulbs: [...(root?.querySelectorAll('.lightbulb-glyph') ?? [])].filter(
        (node) => getComputedStyle(node).display !== 'none'
      ).length
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
  if (initial.visibleLightbulbs !== 0) {
    throw new Error(`Read-only diff shows code-action lightbulbs: ${initial.visibleLightbulbs}`)
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
    target.click()
    return target.querySelector('[title]')?.getAttribute('title') ?? null
  })()`)
  if (!selectedFile) throw new Error('Changed file could not be resolved')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'unified'`,
    'selected file diff'
  )
  const selectedTitle = selectedFile.split(/[\\/]/).at(-1)
  await waitFor(
    `document.querySelector(${JSON.stringify(`${session} .larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title`)})?.textContent?.trim() === ${JSON.stringify(selectedTitle)}`,
    'selected file tab title'
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
  await waitFor(
    `Array.from(document.querySelectorAll(${JSON.stringify(`${view} .monaco-diff-editor .editor.original, ${view} .monaco-diff-editor .editor.modified`)})).length === 2 && Array.from(document.querySelectorAll(${JSON.stringify(`${view} .monaco-diff-editor .editor.original, ${view} .monaco-diff-editor .editor.modified`)})).every((editor) => editor.getBoundingClientRect().width > 0)`,
    'split editor layout'
  )
  const splitEditorWidths = await evaluate(`(() => {
    const selector = ${JSON.stringify(`${view} .monaco-diff-editor .editor.original, ${view} .monaco-diff-editor .editor.modified`)}
    return Array.from(document.querySelectorAll(selector)).map((editor) =>
      editor.getBoundingClientRect().width
    )
  })()`)
  if (splitEditorWidths.length < 2 || splitEditorWidths.some((width) => width <= 0)) {
    throw new Error(`Split diff editors are not visible: ${splitEditorWidths.join(', ')}`)
  }
  const splitGutterGeometry = await evaluate(`(() => {
    const selector = ${JSON.stringify(`${view} .monaco-diff-editor .editor.original .monaco-editor, ${view} .monaco-diff-editor .editor.modified .monaco-editor`)}
    return Array.from(document.querySelectorAll(selector)).map((editor) => {
      const root = editor.getBoundingClientRect()
      const margin = editor.querySelector('.margin')?.getBoundingClientRect()
      const lineNumber = editor.querySelector('.line-numbers')?.getBoundingClientRect()
      const content = editor.querySelector('.lines-content')?.getBoundingClientRect()
      return {
        contentGap: lineNumber && content ? content.left - lineNumber.right : null,
        contentLeft: content ? content.left - root.left : null,
        marginWidth: margin?.width ?? null,
        numberRight: lineNumber ? lineNumber.right - root.left : null
      }
    })
  })()`)
  if (
    splitGutterGeometry.length !== 2 ||
    splitGutterGeometry.some(
      (gutter) =>
        gutter.contentGap === null ||
        gutter.contentLeft === null ||
        gutter.marginWidth === null ||
        gutter.numberRight === null ||
        gutter.contentGap < 8 ||
        gutter.contentGap > 10 ||
        gutter.marginWidth < 40 ||
        gutter.marginWidth > 42 ||
        gutter.numberRight < 31 ||
        gutter.numberRight > 33
    ) ||
    Math.abs(splitGutterGeometry[0].marginWidth - splitGutterGeometry[1].marginWidth) > 1 ||
    Math.abs(splitGutterGeometry[0].contentLeft - splitGutterGeometry[1].contentLeft) > 1
  ) {
    throw new Error(`Split gutters differ: ${JSON.stringify(splitGutterGeometry)}`)
  }
  await clickAria('切换到统一视图')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'unified'`,
    'unified diff'
  )
  await waitFor(
    `Array.from(document.querySelectorAll(${JSON.stringify(`${view} .workspace-file-preview .margin-view-overlays`)})).some((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 })`,
    'unified editor layout'
  )
  const unifiedLineNumberColumns = await evaluate(`(() => {
    const selector = ${JSON.stringify(`${view} .workspace-file-preview .margin-view-overlays`)}
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
    }).length
  })()`)
  if (unifiedLineNumberColumns !== 1)
    throw new Error(`Unified diff exposes ${unifiedLineNumberColumns} line-number columns`)
  const gutterGeometry = await evaluate(`(() => {
    const homeIcon = document.querySelector(${JSON.stringify(`${session} .larify-workbench-home svg`)})
    const lineNumbers = Array.from(
      document.querySelectorAll(${JSON.stringify(`${view} .workspace-file-preview .line-numbers`)})
    ).find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
    })
    if (!homeIcon || !lineNumbers?.firstChild) return null
    const numberRange = document.createRange()
    numberRange.selectNodeContents(lineNumbers)
    const code = document.querySelector(${JSON.stringify(`${view} .workspace-file-preview .view-line span`)})
    return {
      homeRight: homeIcon.getBoundingClientRect().right,
      lineNumberRight: numberRange.getBoundingClientRect().right,
      codeLeft: code?.getBoundingClientRect().left
    }
  })()`)
  if (!gutterGeometry || gutterGeometry.codeLeft === undefined)
    throw new Error('Unified gutter geometry could not be measured')
  // Monaco's independently positioned gutter layers can round by a few CSS pixels at
  // fractional Windows display scales (for example 150%).
  if (Math.abs(gutterGeometry.homeRight - gutterGeometry.lineNumberRight) > 4)
    throw new Error(`Unified gutter is misaligned: ${JSON.stringify(gutterGeometry)}`)
  if (gutterGeometry.codeLeft - gutterGeometry.lineNumberRight < 8)
    throw new Error(`Unified gutter has no content gap: ${JSON.stringify(gutterGeometry)}`)
  await clickAria('切换到拆分视图')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'split'`,
    'second split diff'
  )
  await waitFor(
    `Array.from(document.querySelectorAll(${JSON.stringify(`${view} .monaco-diff-editor .editor.original, ${view} .monaco-diff-editor .editor.modified`)})).every((editor) => editor.getBoundingClientRect().width > 0)`,
    'second split editor layout'
  )
  await clickAria('切换到统一视图')
  await waitFor(
    `document.querySelector(${JSON.stringify(`${view} .workspace-file-preview`)})?.getAttribute('data-diff-mode') === 'unified'`,
    'second unified diff'
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
        gutterGeometry,
        selectedFile,
        selectedTitle,
        splitGutterGeometry,
        splitEditorWidths
      },
      null,
      2
    )
  )
} finally {
  cdp.close()
}
