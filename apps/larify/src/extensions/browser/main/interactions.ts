import type { CdpSend } from './snapshotCapture'
import {
  resolveRefToBox,
  resolveRefToObjectId,
  type RefMap,
  type IframeSessions
} from './refResolve'
import { dispatchClick, dispatchHover, dispatchKey, insertText, type MouseButton } from './input'
import { namedKeyInfo, parseKeyChord } from './keymap'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function callOn(
  send: CdpSend,
  objectId: string,
  fn: string,
  args: unknown[] = [],
  sessionId?: string
): Promise<unknown> {
  const res = (await send(
    'Runtime.callFunctionOn',
    {
      objectId,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: false
    },
    sessionId
  )) as { result?: { value?: unknown } }
  return res.result?.value
}

export interface Interactions {
  send: CdpSend
  refMap: RefMap
  sessions?: IframeSessions
}

export async function click(
  ctx: Interactions,
  selector: string,
  button: MouseButton = 'left',
  clickCount = 1
): Promise<void> {
  const { x, y, sessionId } = await resolveRefToBox(ctx.send, ctx.refMap, selector, ctx.sessions)
  await dispatchClick(ctx.send, x, y, button, clickCount, sessionId)
}

export async function dblclick(ctx: Interactions, selector: string): Promise<void> {
  await click(ctx, selector, 'left', 2)
}

export async function hover(ctx: Interactions, selector: string): Promise<void> {
  const { x, y, sessionId } = await resolveRefToBox(ctx.send, ctx.refMap, selector, ctx.sessions)
  await dispatchHover(ctx.send, x, y, sessionId)
}

export async function elementHref(ctx: Interactions, selector: string): Promise<string> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  const href = await callOn(
    ctx.send,
    objectId,
    "function() { var h = this.getAttribute('href'); if (!h) return null; try { return new URL(h, document.baseURI).toString(); } catch(e) { return null; } }",
    [],
    sessionId
  )
  return typeof href === 'string' ? href : ''
}

export async function drag(ctx: Interactions, source: string, target: string): Promise<void> {
  const s = await resolveRefToBox(ctx.send, ctx.refMap, source, ctx.sessions)
  const t = await resolveRefToBox(ctx.send, ctx.refMap, target, ctx.sessions)
  const mouse = (
    type: string,
    x: number,
    y: number,
    extra: object,
    sessionId?: string
  ): Promise<unknown> => ctx.send('Input.dispatchMouseEvent', { type, x, y, ...extra }, sessionId)
  await mouse('mouseMoved', s.x, s.y, {}, s.sessionId)
  await mouse('mousePressed', s.x, s.y, { button: 'left', buttons: 1, clickCount: 1 }, s.sessionId)
  for (let i = 1; i <= 10; i++) {
    const cx = s.x + ((t.x - s.x) * i) / 10
    const cy = s.y + ((t.y - s.y) * i) / 10
    await mouse('mouseMoved', cx, cy, { button: 'left', buttons: 1 }, s.sessionId)
    await sleep(10)
  }
  await mouse('mouseReleased', t.x, t.y, { button: 'left', buttons: 0, clickCount: 1 }, s.sessionId)
}

export async function fill(ctx: Interactions, selector: string, text: string): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  await callOn(ctx.send, objectId, 'function(){ this.focus(); }', [], sessionId)
  await callOn(
    ctx.send,
    objectId,
    "function(){ this.select && this.select(); this.value=''; this.dispatchEvent(new Event('input',{bubbles:true})); }",
    [],
    sessionId
  )
  await insertText(ctx.send, text, sessionId)
}

export async function type(
  ctx: Interactions,
  selector: string,
  text: string,
  clear = false,
  delayMs = 0
): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  await callOn(ctx.send, objectId, 'function(){ this.focus(); }', [], sessionId)
  if (clear) {
    await callOn(
      ctx.send,
      objectId,
      "function(){ if (this.isContentEditable) { this.textContent=''; } else { this.select && this.select(); this.value=''; } this.dispatchEvent(new Event('input',{bubbles:true})); }",
      [],
      sessionId
    )
  }
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') await dispatchKey(ctx.send, namedKeyInfo('enter'), 0, sessionId)
    else if (ch === '\t') await dispatchKey(ctx.send, namedKeyInfo('tab'), 0, sessionId)
    else await insertText(ctx.send, ch, sessionId)
    if (delayMs > 0) await sleep(delayMs)
  }
}

export async function press(ctx: Interactions, key: string): Promise<void> {
  const { modifiers, info } = parseKeyChord(key)
  await dispatchKey(ctx.send, info, modifiers)
}

export async function focus(ctx: Interactions, selector: string): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  await callOn(ctx.send, objectId, 'function(){ this.focus(); }', [], sessionId)
}

export const IS_CHECKED_JS = `function(){
  if (this.tagName === 'INPUT' && (this.type === 'checkbox' || this.type === 'radio')) return !!this.checked;
  const role = this.getAttribute('role');
  if (['checkbox','radio','switch','menuitemcheckbox','menuitemradio','option','treeitem'].includes(role)) return this.getAttribute('aria-checked') === 'true';
  const label = this.tagName === 'LABEL' ? this : (this.closest && this.closest('label'));
  if (label && label.control && (label.control.type === 'checkbox' || label.control.type === 'radio')) return !!label.control.checked;
  const inner = this.querySelector('input[type=checkbox],input[type=radio]');
  if (inner) return !!inner.checked;
  return false;
}`

const JS_CLICK_CHECKBOX = `function(){
  const label = this.tagName === 'LABEL' ? this : (this.closest && this.closest('label'));
  const target = (this.tagName === 'INPUT' && (this.type === 'checkbox' || this.type === 'radio')) ? this : ((label && label.control) || this.querySelector('input[type=checkbox],input[type=radio]') || this);
  target.click();
}`

async function isChecked(ctx: Interactions, selector: string): Promise<boolean> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  return (await callOn(ctx.send, objectId, IS_CHECKED_JS, [], sessionId)) === true
}

async function setChecked(ctx: Interactions, selector: string, target: boolean): Promise<void> {
  if ((await isChecked(ctx, selector)) === target) return
  await click(ctx, selector)
  if ((await isChecked(ctx, selector)) === target) return
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  await callOn(ctx.send, objectId, JS_CLICK_CHECKBOX, [], sessionId)
}

export async function check(ctx: Interactions, selector: string): Promise<void> {
  await setChecked(ctx, selector, true)
}

export async function uncheck(ctx: Interactions, selector: string): Promise<void> {
  await setChecked(ctx, selector, false)
}

const SELECT_JS = `function(vals){
  let matched = 0;
  for (const opt of this.options) {
    const sel = vals.includes(opt.value) || vals.includes((opt.textContent||'').trim());
    opt.selected = sel;
    if (sel) matched++;
  }
  if (matched === 0) {
    return { error: 'No option matched ' + JSON.stringify(vals) + '. Available options: ' + Array.from(this.options).map(o => o.value + ' ("' + (o.textContent||'').trim() + '")').join(', ') };
  }
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { matched };
}`

export async function select(ctx: Interactions, selector: string, values: string[]): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  const res = (await callOn(ctx.send, objectId, SELECT_JS, [values], sessionId)) as {
    error?: string
  } | null
  if (res?.error) throw new Error(res.error)
}

export async function scroll(
  ctx: Interactions,
  selector?: string,
  direction: 'up' | 'down' | 'left' | 'right' = 'down',
  amount = 300
): Promise<void> {
  const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
  const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
  if (selector) {
    const { objectId, sessionId } = await resolveRefToObjectId(
      ctx.send,
      ctx.refMap,
      selector,
      ctx.sessions
    )
    await callOn(ctx.send, objectId, 'function(dx,dy){ this.scrollBy(dx,dy); }', [dx, dy], sessionId)
  } else {
    await ctx.send('Runtime.evaluate', { expression: `window.scrollBy(${dx}, ${dy})` })
  }
}

export async function scrollIntoView(ctx: Interactions, selector: string): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  await callOn(
    ctx.send,
    objectId,
    "function(){ this.scrollIntoView({block:'center',inline:'center'}); }",
    [],
    sessionId
  )
}

const HIGHLIGHT_JS = `function(){
  this.style.outline = '2px solid red';
  this.style.outlineOffset = '2px';
  const el = this;
  setTimeout(() => { el.style.outline=''; el.style.outlineOffset=''; }, 3000);
}`

export async function highlight(ctx: Interactions, selector: string): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  await callOn(ctx.send, objectId, HIGHLIGHT_JS, [], sessionId)
}

export async function upload(
  ctx: Interactions,
  selector: string,
  files: string[]
): Promise<void> {
  const { objectId, sessionId } = await resolveRefToObjectId(
    ctx.send,
    ctx.refMap,
    selector,
    ctx.sessions
  )
  const desc = (await ctx.send('DOM.describeNode', { objectId }, sessionId)) as {
    node?: { backendNodeId?: number }
  }
  const backendNodeId = desc.node?.backendNodeId
  if (backendNodeId === undefined) throw new Error(`could not resolve file input '${selector}'`)
  await ctx.send('DOM.setFileInputFiles', { files, backendNodeId }, sessionId)
}
