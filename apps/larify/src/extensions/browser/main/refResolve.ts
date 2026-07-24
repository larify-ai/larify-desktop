import { resolveAxSession, scanCursor, type CdpSend } from './snapshotCapture'
import { buildSnapshot, type AXNode, type RefEntry } from './snapshot'
import { boxModelCenter } from './input'

export type RefMap = Map<string, RefEntry>
export type IframeSessions = Map<string, string>

export function parseRef(input: string): string | undefined {
  const t = input.trim()
  if (t.startsWith('@')) {
    const s = t.slice(1)
    return s.startsWith('e') && /^[0-9]*$/.test(s.slice(1)) ? s : undefined
  }
  if (t.startsWith('ref=')) {
    const s = t.slice(4)
    return s.startsWith('e') && /^[0-9]*$/.test(s.slice(1)) ? s : undefined
  }
  if (t.length > 1 && t.startsWith('e') && /^[0-9]+$/.test(t.slice(1))) return t
  return undefined
}

function findElementExpr(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xp = JSON.stringify(selector.slice(6))
    return `document.evaluate(${xp}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`
  }
  return `document.querySelector(${JSON.stringify(selector)})`
}

interface BoxModelResult {
  model: { content?: number[] }
}
interface ResolveNodeResult {
  object?: { objectId?: string }
}
interface EvalResult {
  result?: { objectId?: string; value?: unknown }
  exceptionDetails?: { exception?: { description?: string }; text?: string }
}

async function scrollIntoView(
  send: CdpSend,
  backendNodeId: number,
  sessionId?: string
): Promise<void> {
  await send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, sessionId).catch(() => {})
}

const BLOCKER_AT_JS = `(doc, el, x, y) => {
    let d = doc, lx = x, ly = y;
    let hit = d.elementFromPoint(lx, ly);
    while (hit && (hit.tagName === 'IFRAME' || hit.tagName === 'FRAME') && hit.contentDocument && hit !== el) {
        const r = hit.getBoundingClientRect();
        lx -= r.x + hit.clientLeft;
        ly -= r.y + hit.clientTop;
        d = hit.contentDocument;
        hit = d.elementFromPoint(lx, ly);
    }
    if (!hit || hit === el) return null;
    const up = (n) => n.parentNode || n.host || (n.getRootNode && n.getRootNode().host) || null;
    for (let n = hit; n; n = up(n)) { if (n === el) return null; }
    for (let n = el; n; n = up(n)) { if (n === hit) return null; }
    const hitLabel = hit.closest ? hit.closest('label') : null;
    if (hitLabel && (hitLabel.control === el || hitLabel.contains(el))) return null;
    const elLabel = el.closest ? el.closest('label') : null;
    if (elLabel && elLabel.contains(hit)) return null;
    let desc = hit.tagName.toLowerCase();
    if (hit.id) desc += '#' + hit.id;
    else if (typeof hit.className === 'string' && hit.className.trim())
        desc += '.' + hit.className.trim().split(/\\s+/).slice(0, 2).join('.');
    if (!hit.id && hit.closest) {
        const anchored = hit.closest('[id]');
        if (anchored && anchored !== hit)
            desc += ' inside ' + anchored.tagName.toLowerCase() + '#' + anchored.id;
    }
    return desc;
}`

function interceptedError(target: string, blocker: string): string {
  return `Element '${target}' is covered by <${blocker}> at its click point, so the input would land on that element instead. Dismiss or interact with the covering element first (it is often a dialog, banner, or sticky header).`
}

async function checkInterception(
  send: CdpSend,
  backendNodeId: number,
  target: string,
  x: number,
  y: number,
  sessionId?: string
): Promise<void> {
  const resolved = (await send('DOM.resolveNode', { backendNodeId }, sessionId).catch(
    () => null
  )) as ResolveNodeResult | null
  const objectId = resolved?.object?.objectId
  if (!objectId) return
  const fn = `function(x, y) { let topDoc = this.ownerDocument || document; while (topDoc.defaultView && topDoc.defaultView.frameElement) { topDoc = topDoc.defaultView.frameElement.ownerDocument; } const blockerAt = ${BLOCKER_AT_JS}; return blockerAt(topDoc, this, x, y); }`
  const res = (await send(
    'Runtime.callFunctionOn',
    { objectId, functionDeclaration: fn, arguments: [{ value: x }, { value: y }], returnByValue: true },
    sessionId
  ).catch(() => null)) as { result?: { value?: unknown } } | null
  const blocker = res?.result?.value
  if (typeof blocker === 'string' && blocker) throw new Error(interceptedError(target, blocker))
}

async function findNodeIdByRoleName(
  send: CdpSend,
  entry: RefEntry,
  axParams: object,
  sessionId?: string
): Promise<number> {
  const res = (await send('Accessibility.getFullAXTree', axParams, sessionId)) as { nodes: AXNode[] }
  const sameOriginChild = entry.frameId !== undefined && sessionId === undefined
  const cursorMap = await scanCursor(send, sessionId, sameOriginChild ? entry.frameId : undefined)
  const rebuilt = new Map<string, RefEntry>()
  buildSnapshot(res.nodes, rebuilt, 1, cursorMap, undefined, entry.frameId)
  const targetNth = entry.nth ?? 0
  for (const e of rebuilt.values()) {
    if (
      e.role === entry.role &&
      e.name === entry.name &&
      (e.nth ?? 0) === targetNth &&
      e.backendNodeId !== undefined
    ) {
      return e.backendNodeId
    }
  }
  throw new Error(`ref for ${entry.role} "${entry.name}" is stale and could not be re-anchored`)
}

function lookupRef(refMap: RefMap, refId: string): RefEntry {
  const entry = refMap.get(refId)
  if (!entry) throw new Error(`unknown ref @${refId}`)
  return entry
}

async function isConnectedObject(
  send: CdpSend,
  objectId: string,
  sessionId?: string
): Promise<boolean> {
  const res = (await send(
    'Runtime.callFunctionOn',
    {
      objectId,
      functionDeclaration: 'function(){ return this.isConnected === true; }',
      returnByValue: true,
      awaitPromise: false
    },
    sessionId
  ).catch(() => null)) as { result?: { value?: unknown }; exceptionDetails?: unknown } | null
  return !res?.exceptionDetails && res?.result?.value === true
}

export async function resolveRefToBox(
  send: CdpSend,
  refMap: RefMap,
  selectorOrRef: string,
  iframeSessions?: IframeSessions
): Promise<{ x: number; y: number; sessionId?: string }> {
  const refId = parseRef(selectorOrRef)
  if (refId !== undefined) {
    const entry = lookupRef(refMap, refId)
    const { params, sessionId } = resolveAxSession(entry.frameId, iframeSessions)
    if (entry.backendNodeId !== undefined) {
      await scrollIntoView(send, entry.backendNodeId, sessionId)
      let center: { x: number; y: number } | undefined
      try {
        const r = (await send(
          'DOM.getBoxModel',
          { backendNodeId: entry.backendNodeId },
          sessionId
        )) as BoxModelResult
        center = boxModelCenter(r.model)
      } catch {
        // stale backendNodeId → re-anchor below
      }
      if (center) {
        await checkInterception(send, entry.backendNodeId, selectorOrRef, center.x, center.y, sessionId)
        return { ...center, sessionId }
      }
    }
    const fresh = await findNodeIdByRoleName(send, entry, params, sessionId)
    await scrollIntoView(send, fresh, sessionId)
    const r = (await send('DOM.getBoxModel', { backendNodeId: fresh }, sessionId)) as BoxModelResult
    const { x, y } = boxModelCenter(r.model)
    await checkInterception(send, fresh, selectorOrRef, x, y, sessionId)
    return { x, y, sessionId }
  }
  const js = `(() => {
    const el = ${findElementExpr(selectorOrRef)};
    if (!el) return null;
    const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < (window.innerHeight || document.documentElement.clientHeight) &&
      r.left < (window.innerWidth || document.documentElement.clientWidth);
    let r = el.getBoundingClientRect();
    if (!inView(r)) { el.scrollIntoView({block:'center',inline:'center',behavior:'instant'}); r = el.getBoundingClientRect(); }
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const blockerAt = ${BLOCKER_AT_JS};
    return { x, y, blocker: blockerAt(document, el, x, y) };
  })()`
  const res = (await send('Runtime.evaluate', { expression: js, returnByValue: true })) as EvalResult
  const val = res.result?.value as { x: number; y: number; blocker?: string } | null | undefined
  if (!val) throw new Error(`selector '${selectorOrRef}' matched no element`)
  if (typeof val.blocker === 'string' && val.blocker) {
    throw new Error(interceptedError(selectorOrRef, val.blocker))
  }
  return { x: val.x, y: val.y }
}

export async function resolveRefToObjectId(
  send: CdpSend,
  refMap: RefMap,
  selectorOrRef: string,
  iframeSessions?: IframeSessions
): Promise<{ objectId: string; frameId?: string; sessionId?: string }> {
  const refId = parseRef(selectorOrRef)
  if (refId !== undefined) {
    const entry = lookupRef(refMap, refId)
    const { params, sessionId } = resolveAxSession(entry.frameId, iframeSessions)
    if (entry.backendNodeId !== undefined) {
      const r = (await send(
        'DOM.resolveNode',
        { backendNodeId: entry.backendNodeId },
        sessionId
      ).catch(() => null)) as ResolveNodeResult | null
      const objectId = r?.object?.objectId
      if (objectId && (await isConnectedObject(send, objectId, sessionId))) {
        return { objectId, frameId: entry.frameId, sessionId }
      }
    }
    const fresh = await findNodeIdByRoleName(send, entry, params, sessionId)
    const r = (await send('DOM.resolveNode', { backendNodeId: fresh }, sessionId)) as ResolveNodeResult
    const objectId = r.object?.objectId
    if (!objectId) throw new Error(`could not resolve node for ref @${refId}`)
    return { objectId, frameId: entry.frameId, sessionId }
  }
  const res = (await send('Runtime.evaluate', {
    expression: findElementExpr(selectorOrRef),
    returnByValue: false
  })) as EvalResult
  if (res.exceptionDetails) throw new Error(`selector '${selectorOrRef}' is invalid`)
  const objectId = res.result?.objectId
  if (!objectId) throw new Error(`selector '${selectorOrRef}' matched no element`)
  return { objectId }
}
