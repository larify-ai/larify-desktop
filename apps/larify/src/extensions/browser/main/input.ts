import type { CdpSend } from './snapshotCapture'

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
  try {
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
  } catch (error) {
    await send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button, buttons: 0, clickCount },
      sessionId
    ).catch(() => {})
    throw error
  }
}

export async function dispatchHover(
  send: CdpSend,
  x: number,
  y: number,
  sessionId?: string
): Promise<void> {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
}

export async function mouseMove(
  send: CdpSend,
  state: MouseState,
  x: number,
  y: number,
  sessionId?: string
): Promise<void> {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: state.buttons }, sessionId)
  state.x = x
  state.y = y
}

export async function mouseDown(
  send: CdpSend,
  state: MouseState,
  button: MouseButton = 'left',
  sessionId?: string
): Promise<void> {
  const buttons = state.buttons | BUTTON_BITS[button]
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: state.x, y: state.y, button, buttons, clickCount: 1 },
    sessionId
  )
  state.buttons = buttons
}

export async function mouseUp(
  send: CdpSend,
  state: MouseState,
  button: MouseButton = 'left',
  sessionId?: string
): Promise<void> {
  const buttons = state.buttons & ~BUTTON_BITS[button]
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: state.x, y: state.y, button, buttons, clickCount: 1 },
    sessionId
  )
  state.buttons = buttons
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
    {
      type: 'mouseWheel',
      x: state.x,
      y: state.y,
      deltaX,
      deltaY,
      ...(state.buttons ? { buttons: state.buttons } : {})
    },
    sessionId
  )
  await send(
    'Runtime.evaluate',
    {
      expression:
        'new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); })',
      awaitPromise: true
    },
    sessionId
  )
}
