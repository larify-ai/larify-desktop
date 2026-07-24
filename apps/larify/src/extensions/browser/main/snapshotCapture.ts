import {
  buildSnapshot,
  renderBuilt,
  compactTree,
  spliceIframe,
  type AXNode,
  type RefEntry,
  type SnapshotOptions,
  type CursorMap,
  type CursorInfo,
  type LinkTarget
} from './snapshot'
import { randomUUID } from 'node:crypto'

export type CdpSend = (method: string, params?: object, sessionId?: string) => Promise<unknown>

export interface CaptureOptions extends SnapshotOptions {
  urls?: boolean
  compact?: boolean
  selector?: string
}

interface DomNode {
  backendNodeId?: number
  children?: DomNode[]
  shadowRoots?: DomNode[]
  contentDocument?: DomNode
}

function collectBackendIds(node: DomNode | undefined, ids: Set<number>): void {
  if (!node) return
  if (typeof node.backendNodeId === 'number') ids.add(node.backendNodeId)
  for (const c of node.children ?? []) collectBackendIds(c, ids)
  for (const s of node.shadowRoots ?? []) collectBackendIds(s, ids)
  if (node.contentDocument) collectBackendIds(node.contentDocument, ids)
}

async function resolveSelectorIds(send: CdpSend, selector: string): Promise<Set<number>> {
  const ids = new Set<number>()
  const evalRes = (await send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false
  })) as { result?: { objectId?: string } }
  const objectId = evalRes.result?.objectId
  if (!objectId) throw new Error(`selector '${selector}' matched no element`)
  const desc = (await send('DOM.describeNode', { objectId, depth: -1 })) as { node?: DomNode }
  collectBackendIds(desc.node, ids)
  if (ids.size === 0) throw new Error(`could not resolve backendNodeId for selector '${selector}'`)
  return ids
}

function cursorScanJs(marker: string): string {
  return `
(function() {
    var marker = ${JSON.stringify(marker)};
    var results = [];
    if (!document.body) return results;

    var interactiveRoles = {
        'button':1, 'link':1, 'textbox':1, 'checkbox':1, 'radio':1, 'combobox':1, 'listbox':1,
        'menuitem':1, 'menuitemcheckbox':1, 'menuitemradio':1, 'option':1, 'searchbox':1,
        'slider':1, 'spinbutton':1, 'switch':1, 'tab':1, 'treeitem':1
    };
    var interactiveTags = {
        'a':1, 'button':1, 'input':1, 'select':1, 'textarea':1, 'details':1, 'summary':1
    };

    var allElements = document.body.querySelectorAll('*');
    for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];

        if (el.closest && el.closest('[hidden], [aria-hidden="true"]')) continue;

        var tagName = el.tagName.toLowerCase();
        if (interactiveTags[tagName]) continue;

        var role = el.getAttribute('role');
        if (role && interactiveRoles[role.toLowerCase()]) continue;

        var computedStyle = getComputedStyle(el);
        var hasCursorPointer = computedStyle.cursor === 'pointer';
        var hasOnClick = el.hasAttribute('onclick') || el.onclick !== null;
        var tabIndex = el.getAttribute('tabindex');
        var hasTabIndex = tabIndex !== null && tabIndex !== '-1';
        var ce = el.getAttribute('contenteditable');
        var isEditable = ce === '' || ce === 'true';

        if (!hasCursorPointer && !hasOnClick && !hasTabIndex && !isEditable) continue;

        if (hasCursorPointer && !hasOnClick && !hasTabIndex && !isEditable) {
            var parent = el.parentElement;
            if (parent && getComputedStyle(parent).cursor === 'pointer') continue;
        }

        var text = (el.textContent || '').trim().slice(0, 100);

        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        var hiddenInputType = null;
        var hiddenInputChecked = null;
        var hiddenInput = el.querySelector('input[type="radio"], input[type="checkbox"]');
        if (hiddenInput) {
            var hiddenInputStyle = getComputedStyle(hiddenInput);
            var isInputHidden = hiddenInputStyle.display === 'none' || hiddenInputStyle.visibility === 'hidden' || hiddenInput.hidden;
            if (isInputHidden) {
                hiddenInputType = hiddenInput.type;
                hiddenInputChecked = hiddenInput.indeterminate ? 'mixed' : String(hiddenInput.checked);
            }
        }

        el.setAttribute(marker, String(results.length));
        results.push({
            text: text,
            tagName: tagName,
            hasOnClick: hasOnClick,
            hasCursorPointer: hasCursorPointer,
            hasTabIndex: hasTabIndex,
            isEditable: isEditable,
            hiddenInputType: hiddenInputType,
            hiddenInputChecked: hiddenInputChecked
        });
    }
    return results;
})()`
}

function cursorCleanupJs(marker: string): string {
  return `(function(){var marker=${JSON.stringify(marker)};var els=document.querySelectorAll('['+marker+']');for(var i=0;i<els.length;i++)els[i].removeAttribute(marker);return els.length;})()`
}

interface CursorHit {
  text: string
  hasOnClick: boolean
  hasCursorPointer: boolean
  hasTabIndex: boolean
  isEditable: boolean
  hiddenInputType: 'radio' | 'checkbox' | null
  hiddenInputChecked: string | null
}

function toCursorInfo(hit: CursorHit): CursorInfo {
  const hints: string[] = []
  if (hit.hasCursorPointer) hints.push('cursor:pointer')
  if (hit.hasOnClick) hints.push('onclick')
  if (hit.hasTabIndex) hints.push('tabindex')
  if (hit.isEditable) hints.push('contenteditable')
  const kind =
    hit.hasCursorPointer || hit.hasOnClick ? 'clickable' : hit.isEditable ? 'editable' : 'focusable'
  return {
    kind,
    hints,
    text: hit.text,
    hiddenInputKind: hit.hiddenInputType ?? undefined,
    hiddenInputChecked: hit.hiddenInputChecked ?? undefined
  }
}

export async function scanCursor(
  send: CdpSend,
  sessionId?: string,
  frameId?: string
): Promise<CursorMap> {
  const map: CursorMap = new Map()
  const marker = `data-__larify_cursor_${randomUUID().replaceAll('-', '')}`
  let contextId: number | undefined
  try {
    if (frameId) {
      const world = (await send('Page.createIsolatedWorld', {
        frameId,
        worldName: 'larify-cursor',
        grantUniveralAccess: false
      })) as { executionContextId?: number }
      contextId = world.executionContextId
      if (contextId === undefined) return map
    }
    const evalRes = (await send(
      'Runtime.evaluate',
      {
        expression: cursorScanJs(marker),
        returnByValue: true,
        ...(contextId === undefined ? {} : { contextId })
      },
      sessionId
    )) as { result?: { value?: CursorHit[] } }
    const hits = evalRes.result?.value
    if (!hits || hits.length === 0) return map
    let rootNodeId: number
    if (frameId) {
      const owner = (await send('DOM.getFrameOwner', { frameId }, sessionId)) as {
        backendNodeId: number
      }
      const desc = (await send(
        'DOM.describeNode',
        { backendNodeId: owner.backendNodeId, depth: 1 },
        sessionId
      )) as { node?: { contentDocument?: { nodeId?: number } } }
      const nodeId = desc.node?.contentDocument?.nodeId
      if (nodeId === undefined) return map
      rootNodeId = nodeId
    } else {
      const doc = (await send('DOM.getDocument', { depth: 0 }, sessionId)) as {
        root: { nodeId: number }
      }
      rootNodeId = doc.root.nodeId
    }
    const found = (await send(
      'DOM.querySelectorAll',
      { nodeId: rootNodeId, selector: `[${marker}]` },
      sessionId
    )) as { nodeIds: number[] }
    const descs = await Promise.all(
      found.nodeIds.map((nodeId) =>
        send('DOM.describeNode', { nodeId }, sessionId).catch(() => null)
      )
    )
    for (const desc of descs) {
      const dnode = (desc as { node?: { backendNodeId?: number; attributes?: string[] } } | null)
        ?.node
      if (!dnode || dnode.backendNodeId === undefined) continue
      const attrs = dnode.attributes ?? []
      const ciPos = attrs.indexOf(marker)
      if (ciPos < 0 || ciPos % 2 !== 0) continue
      const hit = hits[Number(attrs[ciPos + 1])]
      if (hit) map.set(dnode.backendNodeId, toCursorInfo(hit))
    }
  } catch {
    // ignore
  } finally {
    try {
      await send(
        'Runtime.evaluate',
        {
          expression: cursorCleanupJs(marker),
          ...(contextId === undefined ? {} : { contextId })
        },
        sessionId
      )
    } catch {
      // ignore
    }
  }
  return map
}

async function resolveLinkUrls(
  send: CdpSend,
  links: LinkTarget[],
  sessionId?: string
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  await Promise.all(
    links.map(async ({ refId, backendNodeId }) => {
      try {
        const resolved = (await send('DOM.resolveNode', { backendNodeId }, sessionId)) as {
          object?: { objectId?: string }
        }
        const objectId = resolved.object?.objectId
        if (!objectId) return
        const call = (await send(
          'Runtime.callFunctionOn',
          {
            objectId,
            functionDeclaration: 'function(){return this.href||""}',
            returnByValue: true
          },
          sessionId
        )) as { result?: { value?: string } }
        const href = call.result?.value
        if (href) urls.set(refId, href)
      } catch {
        // ignore
      }
    })
  )
  return urls
}

async function resolveIframeFrameId(
  send: CdpSend,
  backendNodeId: number,
  sessionId?: string
): Promise<string | undefined> {
  try {
    const d = (await send('DOM.describeNode', { backendNodeId, depth: 1 }, sessionId)) as {
      node?: { contentDocument?: { frameId?: string }; frameId?: string }
    }
    return d.node?.contentDocument?.frameId ?? d.node?.frameId
  } catch {
    return undefined
  }
}

export function resolveAxSession(
  frameId: string | undefined,
  iframeSessions?: Map<string, string>
): { params: object; sessionId?: string } {
  if (frameId === undefined) return { params: {} }
  const sid = iframeSessions?.get(frameId)
  if (sid !== undefined) return { params: {}, sessionId: sid }
  return { params: { frameId } }
}

export async function captureSnapshot(
  send: CdpSend,
  refMap: Map<string, RefEntry>,
  startRef: number,
  opts: CaptureOptions,
  iframeSessions?: Map<string, string>
): Promise<{ text: string; nextRef: number }> {
  await send('DOM.enable')
  await send('Accessibility.enable')
  const selectorIds = opts.selector ? await resolveSelectorIds(send, opts.selector) : undefined
  let nextRef = startRef

  const frame = async (frameId: string | undefined, recurse: boolean): Promise<string> => {
    const { params: axParams, sessionId } = resolveAxSession(frameId, iframeSessions)
    if (sessionId !== undefined) {
      await send('DOM.enable', {}, sessionId).catch(() => {})
      await send('Accessibility.enable', {}, sessionId).catch(() => {})
    }
    const sameOriginChild = frameId !== undefined && sessionId === undefined
    const cursorMap: CursorMap = await scanCursor(
      send,
      sessionId,
      sameOriginChild ? frameId : undefined
    )
    const res = (await send('Accessibility.getFullAXTree', axParams, sessionId)) as {
      nodes: AXNode[]
    }
    const built = buildSnapshot(
      res.nodes,
      refMap,
      nextRef,
      cursorMap,
      frameId ? undefined : selectorIds,
      frameId
    )
    nextRef = built.nextRef
    const urls = opts.urls ? await resolveLinkUrls(send, built.links, sessionId) : undefined
    let text = renderBuilt(built, opts, urls)
    if (!recurse) return text
    for (const { refId, backendNodeId } of built.iframes) {
      const childFrameId = await resolveIframeFrameId(send, backendNodeId, sessionId)
      if (!childFrameId) continue
      let childText = ''
      try {
        childText = await frame(childFrameId, false)
      } catch {
        continue
      }
      if (
        childText === '' ||
        childText === '(empty page)' ||
        childText === '(no interactive elements)'
      )
        continue
      text = spliceIframe(text, refId, childText)
    }
    return text
  }

  let text = await frame(undefined, true)
  if (opts.compact) text = compactTree(text, opts.interactive ?? false)
  return { text, nextRef }
}
