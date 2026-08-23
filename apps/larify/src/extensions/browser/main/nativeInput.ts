import type { WebContents } from "electron"
import { charToKeyInfo, keyText, namedKeyInfo, type KeyInfo } from "./keymap"

type NativeKeyEvent = Electron.KeyboardInputEvent

const ELECTRON_KEY_CODES: Partial<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
}

const usesCdpInput = (contents: WebContents): boolean =>
  contents.getType?.() === "window" && contents.debugger.isAttached()

async function invokeWebview(
  contents: WebContents,
  method: "insertText" | "sendInputEvent",
  argument: string | NativeKeyEvent
): Promise<boolean> {
  if (contents.getType?.() !== "webview") return false
  const host = contents.hostWebContents
  if (!host || host.isDestroyed()) return false
  const guestId = contents.id
  const script = `(() => {
    const guestId = ${guestId}
    const webview = [...document.querySelectorAll('webview')]
      .find((candidate) => {
        try { return candidate.getWebContentsId() === guestId } catch { return false }
      })
    if (!webview) throw new Error('browser webview is unavailable')
    const method = ${JSON.stringify(method)}
    const argument = ${JSON.stringify(argument)}
    webview[method](argument)
    return webview.executeJavaScript('void 0')
  })()`
  await host.executeJavaScript(script)
  return true
}

async function sendKeyEvent(contents: WebContents, event: NativeKeyEvent): Promise<void> {
  if (!(await invokeWebview(contents, "sendInputEvent", event))) contents.sendInputEvent(event)
}

function modifiers(bits: number): NonNullable<Electron.InputEvent["modifiers"]> {
  const result: NonNullable<Electron.InputEvent["modifiers"]> = []
  if (bits & 1) result.push("alt")
  if (bits & 2) result.push("control")
  if (bits & 4) result.push("meta")
  if (bits & 8) result.push("shift")
  return result
}

export async function keyDown(
  contents: WebContents,
  info: KeyInfo,
  modifierBits = 0
): Promise<void> {
  if (usesCdpInput(contents)) {
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.keyCode,
      nativeVirtualKeyCode: info.keyCode,
      modifiers: modifierBits,
    })
  } else {
    const event: NativeKeyEvent = {
      type: "keyDown",
      keyCode: ELECTRON_KEY_CODES[info.key] ?? info.key,
      modifiers: modifiers(modifierBits),
    }
    await sendKeyEvent(contents, event)
  }
  const text = (modifierBits & (2 | 4)) === 0 ? keyText(info.key) : undefined
  if (text !== undefined && text !== "\t") {
    await insertText(contents, info.key === "Enter" ? "\n" : text)
  }
}

export async function keyUp(
  contents: WebContents,
  info: KeyInfo,
  modifierBits = 0
): Promise<void> {
  if (usesCdpInput(contents)) {
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.keyCode,
      nativeVirtualKeyCode: info.keyCode,
      modifiers: modifierBits,
    })
    return
  }
  const event: NativeKeyEvent = {
    type: "keyUp",
    keyCode: ELECTRON_KEY_CODES[info.key] ?? info.key,
    modifiers: modifiers(modifierBits),
  }
  await sendKeyEvent(contents, event)
}

export async function dispatchKey(
  contents: WebContents,
  info: KeyInfo,
  modifierBits = 0
): Promise<void> {
  try {
    await keyDown(contents, info, modifierBits)
    await keyUp(contents, info, modifierBits)
  } catch (error) {
    await keyUp(contents, info, modifierBits).catch(() => {})
    throw error
  }
}

export async function pressKey(
  contents: WebContents,
  info: KeyInfo,
  modifierBits = 0,
  heldModifierBits = 0
): Promise<void> {
  const modifierKeys: Array<[number, KeyInfo]> = [
    [1, namedKeyInfo("alt")],
    [2, namedKeyInfo("control")],
    [4, namedKeyInfo("meta")],
    [8, namedKeyInfo("shift")],
  ]
  const pressed = modifierKeys.filter(([bit]) => (modifierBits & bit) && !(heldModifierBits & bit))
  const attempted: Array<[number, KeyInfo]> = []
  let activeModifiers = heldModifierBits
  try {
    for (const [bit, modifier] of pressed) {
      activeModifiers |= bit
      attempted.push([bit, modifier])
      await keyDown(contents, modifier, activeModifiers)
    }
    await dispatchKey(contents, info, modifierBits | heldModifierBits)
  } finally {
    for (const [bit, modifier] of attempted.reverse()) {
      activeModifiers &= ~bit
      await keyUp(contents, modifier, activeModifiers).catch(() => {})
    }
  }
}

export async function insertText(contents: WebContents, text: string): Promise<void> {
  if (await invokeWebview(contents, "insertText", text)) return
  if (usesCdpInput(contents)) {
    await contents.debugger.sendCommand("Input.insertText", { text })
    return
  }
  await contents.insertText(text)
}

export async function typeText(
  contents: WebContents,
  text: string,
  modifierBits = 0
): Promise<void> {
  for (const ch of text) {
    const info = charToKeyInfo(ch)
    if (!info) {
      await insertText(contents, ch)
      continue
    }
    const activeModifiers = modifierBits | (info.shift ? 8 : 0)
    await dispatchKey(contents, info, activeModifiers)
  }
}
