import type { CdpSend } from './snapshotCapture'
import { keyText, namedKeyInfo, type KeyInfo } from './keymap'

export type MouseButton = 'left' | 'right' | 'middle'

const BUTTON_BITS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 }

export interface MouseState {
  x: number
  y: number
  buttons: number
}

export function newMouseState(): MouseState {
  return { x: 0, y: 0, buttons: 0 }
}

export interface BoxModel {
  content?: number[]
}

export function boxModelCenter(model: BoxModel): { x: number; y: number } {
  const c = model.content
  if (c && c.length >= 8) {
    return { x: (c[0] + c[2] + c[4] + c[6]) / 4, y: (c[1] + c[3] + c[5] + c[7]) / 4 }
  }
  return { x: 0, y: 0 }
}

export async function dispatchClick(
  send: CdpSend,
  x: number,
  y: number,
  button: MouseButton = 'left',
  clickCount = 1,
  sessionId?: string
): Promise<void> {
  const buttons = BUTTON_BITS[button]
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x, y, button, buttons, clickCount },
    sessionId
  )
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x, y, button, buttons: 0, clickCount },
    sessionId
  )
}

export async function dispatchHover(
  send: CdpSend,
  x: number,
  y: number,
  sessionId?: string
): Promise<void> {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
}

export async function keyDown(
  send: CdpSend,
  info: KeyInfo,
  modifiers = 0,
  sessionId?: string
): Promise<void> {
  const commandChord = (modifiers & 2) !== 0 || (modifiers & 4) !== 0
  const text = commandChord ? undefined : keyText(info.key)
  const down: Record<string, unknown> = {
    type: 'keyDown',
    key: info.key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    modifiers
  }
  if (text !== undefined) {
    down.text = text
    down.unmodifiedText = text
  }
  await send('Input.dispatchKeyEvent', down, sessionId)
}

export async function keyUp(
  send: CdpSend,
  info: KeyInfo,
  modifiers = 0,
  sessionId?: string
): Promise<void> {
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.keyCode,
      nativeVirtualKeyCode: info.keyCode,
      modifiers
    },
    sessionId
  )
}

export async function dispatchKey(
  send: CdpSend,
  info: KeyInfo,
  modifiers = 0,
  sessionId?: string
): Promise<void> {
  await keyDown(send, info, modifiers, sessionId)
  await keyUp(send, info, modifiers, sessionId)
}

export async function insertText(send: CdpSend, text: string, sessionId?: string): Promise<void> {
  await send('Input.insertText', { text }, sessionId)
}

export async function typeText(send: CdpSend, text: string, sessionId?: string): Promise<void> {
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') await dispatchKey(send, namedKeyInfo('enter'), 0, sessionId)
    else if (ch === '\t') await dispatchKey(send, namedKeyInfo('tab'), 0, sessionId)
    else await insertText(send, ch, sessionId)
  }
}

export async function mouseMove(
  send: CdpSend,
  state: MouseState,
  x: number,
  y: number,
  sessionId?: string
): Promise<void> {
  state.x = x
  state.y = y
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: state.buttons }, sessionId)
}

export async function mouseDown(
  send: CdpSend,
  state: MouseState,
  button: MouseButton = 'left',
  sessionId?: string
): Promise<void> {
  state.buttons |= BUTTON_BITS[button]
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: state.x, y: state.y, button, buttons: state.buttons, clickCount: 1 },
    sessionId
  )
}

export async function mouseUp(
  send: CdpSend,
  state: MouseState,
  button: MouseButton = 'left',
  sessionId?: string
): Promise<void> {
  state.buttons &= ~BUTTON_BITS[button]
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: state.x, y: state.y, button, buttons: state.buttons, clickCount: 1 },
    sessionId
  )
}

export async function mouseWheel(
  send: CdpSend,
  state: MouseState,
  deltaX: number,
  deltaY: number,
  sessionId?: string
): Promise<void> {
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: state.x, y: state.y, deltaX, deltaY },
    sessionId
  )
}
