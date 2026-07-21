import type { Protocol } from 'devtools-protocol'

export type AXNode = Protocol.Accessibility.AXNode
type AXValue = Protocol.Accessibility.AXValue

export interface CursorInfo {
  kind: 'clickable' | 'editable' | 'focusable'
  hints: string[]
  text: string
  hiddenInputKind?: 'radio' | 'checkbox'
  hiddenInputChecked?: string
}
export type CursorMap = Map<number, CursorInfo>

export interface RefEntry {
  backendNodeId?: number
  role: string
  name: string
  nth?: number
  frameId?: string
}

export interface SnapshotOptions {
  interactive?: boolean
  depth?: number
}

export interface Node {
  role: string
  name: string
  value?: string
  level?: number
  checked?: string
  expanded?: boolean
  selected?: boolean
  disabled?: boolean
  required?: boolean
  backendNodeId?: number
  cursorInfo?: CursorInfo
  url?: string
  children: number[]
  hasRef: boolean
  refId?: string
}

export interface LinkTarget {
  refId: string
  backendNodeId: number
}

export interface BuiltSnapshot {
  tree: Node[]
  roots: number[]
  nextRef: number
  links: LinkTarget[]
  iframes: LinkTarget[]
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
  'Iframe'
])

const CONTENT_ROLES = new Set([
  'heading',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'listitem',
  'article',
  'region',
  'main',
  'navigation'
])

const FORMAT_CHARS = /\p{Cf}/gu
const SPACES = /\p{Zs}/gu

function cleanName(name: string): string {
  return name.replace(FORMAT_CHARS, '').replace(SPACES, ' ').replace(/\s+/g, ' ').trim()
}

export function axStr(v?: AXValue): string | undefined {
  const x = v?.value
  if (typeof x === 'string') return x || undefined
  if (typeof x === 'number') return String(x)
  return undefined
}

function isRefWorthy(node: Node, cursorMap?: CursorMap): boolean {
  if (node.backendNodeId !== undefined && cursorMap?.has(node.backendNodeId)) return true
  if (INTERACTIVE_ROLES.has(node.role)) return true
  if (CONTENT_ROLES.has(node.role)) return node.name !== ''
  return false
}

function buildTree(nodes: AXNode[], cursorMap?: CursorMap): { tree: Node[]; roots: number[] } {
  const idToIdx = new Map<string, number>()
  nodes.forEach((n, i) => idToIdx.set(n.nodeId, i))

  const tree: Node[] = nodes.map((n) => {
    const role = axStr(n.role) ?? ''
    if ((n.ignored && role !== 'RootWebArea') || role === 'InlineTextBox') {
      return { role: '', name: '', children: [], hasRef: false }
    }
    const node: Node = {
      role,
      name: axStr(n.name) ?? '',
      value: axStr(n.value),
      backendNodeId: n.backendDOMNodeId,
      children: [],
      hasRef: false
    }
    if (node.backendNodeId !== undefined) node.cursorInfo = cursorMap?.get(node.backendNodeId)
    for (const p of n.properties ?? []) {
      const val = p.value?.value
      if (p.name === 'level' && typeof val === 'number' && Number.isInteger(val)) node.level = val
      else if (p.name === 'checked' && val !== undefined)
        node.checked = typeof val === 'string' ? val : val === true ? 'true' : 'false'
      else if (p.name === 'expanded' && typeof val === 'boolean') node.expanded = val
      else if (p.name === 'selected') node.selected = val === true
      else if (p.name === 'disabled') node.disabled = val === true
      else if (p.name === 'required') node.required = val === true
    }
    return node
  })

  const isChild = new Array(tree.length).fill(false)
  nodes.forEach((n, i) => {
    for (const cid of n.childIds ?? []) {
      const ci = idToIdx.get(cid)
      if (ci !== undefined) {
        tree[i].children.push(ci)
        isChild[ci] = true
      }
    }
  })

  aggregateStaticText(tree)
  if (cursorMap) promoteHiddenInputs(tree, cursorMap)

  const roots = tree.map((_, i) => i).filter((i) => !isChild[i])
  return { tree, roots }
}

function clearNode(node: Node): void {
  node.role = ''
  node.name = ''
  node.children = []
  node.backendNodeId = undefined
}

function aggregateStaticText(tree: Node[]): void {
  for (const node of tree) {
    if (!node.role || node.children.length === 0) continue
    const ch = node.children
    let s = 0
    while (s < ch.length) {
      if (tree[ch[s]].role !== 'StaticText') {
        s++
        continue
      }
      let e = s + 1
      while (e < ch.length && tree[ch[e]].role === 'StaticText') e++
      if (e > s + 1) {
        tree[ch[s]].name = ch
          .slice(s, e)
          .map((i) => tree[i].name)
          .join('')
        for (let j = s + 1; j < e; j++) clearNode(tree[ch[j]])
      }
      s = e
    }
    if (ch.length === 1 && tree[ch[0]].role === 'StaticText' && node.name === tree[ch[0]].name) {
      clearNode(tree[ch[0]])
    }
  }
}

function promoteHiddenInputs(tree: Node[], cursorMap: CursorMap): void {
  for (const node of tree) {
    if (node.role !== 'LabelText' && node.role !== 'generic') continue
    const info = node.backendNodeId !== undefined ? cursorMap.get(node.backendNodeId) : undefined
    if (!info?.hiddenInputKind) continue
    node.role = info.hiddenInputKind
    if (node.name === '' && info.text !== '') node.name = info.text
    if (info.hiddenInputChecked !== undefined) node.checked = info.hiddenInputChecked
  }
}

function assignRefs(
  tree: Node[],
  refMap: Map<string, RefEntry>,
  startRef: number,
  cursorMap: CursorMap | undefined,
  links: LinkTarget[],
  frameId?: string
): number {
  const seen = new Map<string, number>()
  const added: RefEntry[] = []
  let next = startRef
  for (const node of tree) {
    if (!node.role || !isRefWorthy(node, cursorMap)) continue
    const role = node.role
    const key = `${role}:${node.name}`
    const nth = seen.get(key) ?? 0
    seen.set(key, nth + 1)
    const refId = `e${next++}`
    node.hasRef = true
    node.refId = refId
    const entry: RefEntry = { backendNodeId: node.backendNodeId, role, name: node.name, nth, frameId }
    refMap.set(refId, entry)
    added.push(entry)
    if (role === 'link' && node.backendNodeId !== undefined) {
      links.push({ refId, backendNodeId: node.backendNodeId })
    }
  }
  for (const entry of added) {
    const key = `${entry.role}:${entry.name}`
    if ((seen.get(key) ?? 0) <= 1) entry.nth = undefined
  }
  return next
}

function renderTree(
  tree: Node[],
  idx: number,
  indent: number,
  out: string[],
  opts: SnapshotOptions,
  urls: Map<string, string> | undefined,
  visited: Set<number>
): void {
  if (visited.has(idx)) return
  visited.add(idx)
  const node = tree[idx]
  let name = cleanName(node.name)
  if (name === '' && opts.interactive && node.cursorInfo?.text)
    name = cleanName(node.cursorInfo.text)
  if (
    node.role === '' ||
    (node.role === 'generic' && !node.hasRef && node.children.length <= 1) ||
    (node.role === 'StaticText' && name === '') ||
    (opts.interactive && !node.hasRef)
  ) {
    for (const c of node.children) renderTree(tree, c, indent, out, opts, urls, visited)
    return
  }
  if (node.role === 'RootWebArea' || node.role === 'WebArea') {
    for (const c of node.children) renderTree(tree, c, indent, out, opts, urls, visited)
    return
  }
  if (opts.depth !== undefined && indent > opts.depth) return
  let line = `${'  '.repeat(indent)}- ${node.role}`
  if (name !== '') line += ` ${JSON.stringify(name)}`
  const attrs: string[] = []
  if (node.level !== undefined) attrs.push(`level=${node.level}`)
  if (node.checked !== undefined) attrs.push(`checked=${node.checked}`)
  if (node.expanded !== undefined) attrs.push(`expanded=${node.expanded}`)
  if (node.selected) attrs.push('selected')
  if (node.disabled) attrs.push('disabled')
  if (node.required) attrs.push('required')
  if (node.refId) attrs.push(`ref=${node.refId}`)
  const url = node.refId ? urls?.get(node.refId) : undefined
  if (url) attrs.push(`url=${url}`)
  if (attrs.length) line += ` [${attrs.join(', ')}]`
  if (node.hasRef && node.cursorInfo) {
    line += ` ${node.cursorInfo.kind}`
    if (node.cursorInfo.hints.length) line += ` [${node.cursorInfo.hints.join(', ')}]`
  }
  if (node.value && node.value !== node.name) line += `: ${JSON.stringify(node.value)}`
  out.push(line)

  for (const c of node.children) renderTree(tree, c, indent + 1, out, opts, urls, visited)
}

function subtreeRoots(tree: Node[], selectorIds: Set<number>): number[] {
  const parentOf = new Array<number | undefined>(tree.length).fill(undefined)
  tree.forEach((n, i) => {
    for (const c of n.children) parentOf[c] = i
  })
  const inSubtree = tree.map(
    (n) => n.backendNodeId !== undefined && selectorIds.has(n.backendNodeId)
  )
  const roots: number[] = []
  tree.forEach((_, i) => {
    if (!inSubtree[i]) return
    const p = parentOf[i]
    if (p === undefined || !inSubtree[p]) roots.push(i)
  })
  return roots
}

export function buildSnapshot(
  nodes: AXNode[],
  refMap: Map<string, RefEntry>,
  startRef: number,
  cursorMap?: CursorMap,
  selectorIds?: Set<number>,
  frameId?: string
): BuiltSnapshot {
  const { tree, roots } = buildTree(nodes, cursorMap)
  const links: LinkTarget[] = []
  const nextRef = assignRefs(tree, refMap, startRef, cursorMap, links, frameId)
  const iframes: LinkTarget[] = []
  for (const node of tree) {
    if (node.role === 'Iframe' && node.refId && node.backendNodeId !== undefined) {
      iframes.push({ refId: node.refId, backendNodeId: node.backendNodeId })
    }
  }
  const effectiveRoots = selectorIds ? subtreeRoots(tree, selectorIds) : roots
  if (selectorIds && effectiveRoots.length === 0) {
    throw new Error('selector matched no accessibility node')
  }
  return { tree, roots: effectiveRoots, nextRef, links, iframes }
}

export function renderBuilt(
  built: BuiltSnapshot,
  opts: SnapshotOptions = {},
  urls?: Map<string, string>
): string {
  const out: string[] = []
  const visited = new Set<number>()
  for (const r of built.roots) renderTree(built.tree, r, 0, out, opts, urls, visited)
  const text = out.join('\n').trim()
  if (text === '') return opts.interactive ? '(no interactive elements)' : '(empty page)'
  return text
}

export function spliceIframe(output: string, refId: string, childText: string): string {
  const pos = output.indexOf(`[ref=${refId}]`)
  if (pos < 0) return output
  const lineEndRel = output.indexOf('\n', pos)
  const lineEnd = lineEndRel < 0 ? output.length : lineEndRel
  const lineStart = output.lastIndexOf('\n', pos) + 1
  const iframeLine = output.slice(lineStart, lineEnd)
  const iframeIndent = iframeLine.length - iframeLine.trimStart().length
  const prefix = ' '.repeat(iframeIndent + 2)
  const indentedChild = childText
    .split('\n')
    .map((l) => prefix + l)
    .join('\n')
  if (lineEnd === output.length) return `${output}\n${indentedChild}`
  return `${output.slice(0, lineEnd + 1)}${indentedChild}\n${output.slice(lineEnd + 1)}`
}

export function compactTree(text: string, interactive: boolean): string {
  if (text === '') return ''
  const lines = text.split('\n')
  const keep = new Array(lines.length).fill(false)
  const indentOf = (line: string): number => (line.length - line.trimStart().length) / 2
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('ref=') && !lines[i].includes(': ')) continue
    keep[i] = true
    const my = indentOf(lines[i])
    for (let j = i - 1; j >= 0; j--) {
      const anc = indentOf(lines[j])
      if (anc < my) {
        keep[j] = true
        if (anc === 0) break
      }
    }
  }
  const out = lines.filter((_, i) => keep[i]).join('\n')
  if (out.trim() === '' && interactive) return '(no interactive elements)'
  return out
}

export function renderSnapshot(
  nodes: AXNode[],
  refMap: Map<string, RefEntry>,
  startRef: number,
  opts: SnapshotOptions = {},
  cursorMap?: CursorMap
): { text: string; nextRef: number } {
  const built = buildSnapshot(nodes, refMap, startRef, cursorMap)
  return { text: renderBuilt(built, opts), nextRef: built.nextRef }
}
