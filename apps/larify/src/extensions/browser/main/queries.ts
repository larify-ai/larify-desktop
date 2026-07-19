import type { CdpSend } from './snapshotCapture'
import { resolveRefToObjectId } from './refResolve'
import { callOn, IS_CHECKED_JS, type Interactions } from './interactions'

export type QueryCtx = Interactions

const GET_TEXT_JS = `function() { return this.innerText || this.textContent || ''; }`
const GET_HTML_JS = `function() { return this.innerHTML || ''; }`
const GET_VALUE_JS = `function() { return typeof this.value === 'string' ? this.value : ''; }`
const GET_ATTR_JS = `function(n) { return this.getAttribute(n); }`
const GET_BOX_JS = `function() { const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }`
const IS_VISIBLE_JS = `function() {
  const rect = this.getBoundingClientRect();
  const style = window.getComputedStyle(this);
  return rect.width > 0 && rect.height > 0 &&
         style.visibility !== 'hidden' &&
         style.display !== 'none' &&
         parseFloat(style.opacity) > 0;
}`
const IS_ENABLED_JS = `function() { return !this.disabled; }`

async function callString(ctx: QueryCtx, selector: string, fn: string): Promise<string> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  const v = await callOn(ctx.send, objectId, fn, [], sessionId)
  return typeof v === 'string' ? v : ''
}

export async function getText(ctx: QueryCtx, selector: string): Promise<string> {
  return callString(ctx, selector, GET_TEXT_JS)
}

export async function getHtml(ctx: QueryCtx, selector: string): Promise<string> {
  return callString(ctx, selector, GET_HTML_JS)
}

export async function getValue(ctx: QueryCtx, selector: string): Promise<string> {
  return callString(ctx, selector, GET_VALUE_JS)
}

export async function getAttr(
  ctx: QueryCtx,
  selector: string,
  name: string
): Promise<string | null> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  const v = await callOn(ctx.send, objectId, GET_ATTR_JS, [name], sessionId)
  return typeof v === 'string' ? v : null
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export async function getBox(ctx: QueryCtx, selector: string): Promise<Box> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  const v = (await callOn(ctx.send, objectId, GET_BOX_JS, [], sessionId)) as Box | undefined
  if (!v || typeof v.width !== 'number') throw new Error(`could not get bounding box for '${selector}'`)
  return v
}

export async function isVisible(ctx: QueryCtx, selector: string): Promise<boolean> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  return (await callOn(ctx.send, objectId, IS_VISIBLE_JS, [], sessionId)) === true
}

export async function isEnabled(ctx: QueryCtx, selector: string): Promise<boolean> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  return (await callOn(ctx.send, objectId, IS_ENABLED_JS, [], sessionId)) !== false
}

export async function isChecked(ctx: QueryCtx, selector: string): Promise<boolean> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  return (await callOn(ctx.send, objectId, IS_CHECKED_JS, [], sessionId)) === true
}

const STYLES_ALL_JS = `function() {
  const s = window.getComputedStyle(this);
  const result = {};
  for (let i = 0; i < s.length; i++) { const p = s[i]; result[p] = s.getPropertyValue(p); }
  return result;
}`
const STYLES_SUBSET_JS = `function(props) {
  const s = window.getComputedStyle(this);
  const result = {};
  for (const p of props) result[p] = s.getPropertyValue(p);
  return result;
}`

export async function getStyles(
  ctx: QueryCtx,
  selector: string,
  properties?: string[]
): Promise<Record<string, string>> {
  const { objectId, sessionId } = await resolveRefToObjectId(ctx.send, ctx.refMap, selector, ctx.sessions)
  const v = properties?.length
    ? await callOn(ctx.send, objectId, STYLES_SUBSET_JS, [properties], sessionId)
    : await callOn(ctx.send, objectId, STYLES_ALL_JS, [], sessionId)
  return v && typeof v === 'object' ? (v as Record<string, string>) : {}
}

function countExpr(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xp = JSON.stringify(selector.slice(6))
    return `document.evaluate(${xp}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength`
  }
  return `document.querySelectorAll(${JSON.stringify(selector)}).length`
}

export async function getCount(ctx: { send: CdpSend }, selector: string): Promise<number> {
  const res = (await ctx.send('Runtime.evaluate', {
    expression: countExpr(selector),
    returnByValue: true
  })) as { result?: { value?: unknown } }
  const v = res.result?.value
  return typeof v === 'number' ? v : 0
}
