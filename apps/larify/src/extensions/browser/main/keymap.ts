export interface KeyInfo {
  key: string
  code: string
  keyCode: number
}

export const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8
}

const NAMED_KEYS: Record<string, KeyInfo> = {
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  ctrl: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  cmd: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  command: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  return: { key: 'Enter', code: 'Enter', keyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 }
}

const PUNCTUATION: Record<string, KeyInfo> = {
  '!': { key: '!', code: 'Digit1', keyCode: 49 },
  '@': { key: '@', code: 'Digit2', keyCode: 50 },
  '#': { key: '#', code: 'Digit3', keyCode: 51 },
  $: { key: '$', code: 'Digit4', keyCode: 52 },
  '%': { key: '%', code: 'Digit5', keyCode: 53 },
  '^': { key: '^', code: 'Digit6', keyCode: 54 },
  '&': { key: '&', code: 'Digit7', keyCode: 55 },
  '*': { key: '*', code: 'Digit8', keyCode: 56 },
  '(': { key: '(', code: 'Digit9', keyCode: 57 },
  ')': { key: ')', code: 'Digit0', keyCode: 48 },
  '`': { key: '`', code: 'Backquote', keyCode: 192 },
  '~': { key: '~', code: 'Backquote', keyCode: 192 },
  '-': { key: '-', code: 'Minus', keyCode: 189 },
  _: { key: '_', code: 'Minus', keyCode: 189 },
  '=': { key: '=', code: 'Equal', keyCode: 187 },
  '+': { key: '+', code: 'Equal', keyCode: 187 },
  '[': { key: '[', code: 'BracketLeft', keyCode: 219 },
  '{': { key: '{', code: 'BracketLeft', keyCode: 219 },
  ']': { key: ']', code: 'BracketRight', keyCode: 221 },
  '}': { key: '}', code: 'BracketRight', keyCode: 221 },
  '\\': { key: '\\', code: 'Backslash', keyCode: 220 },
  '|': { key: '|', code: 'Backslash', keyCode: 220 },
  ';': { key: ';', code: 'Semicolon', keyCode: 186 },
  ':': { key: ':', code: 'Semicolon', keyCode: 186 },
  "'": { key: "'", code: 'Quote', keyCode: 222 },
  '"': { key: '"', code: 'Quote', keyCode: 222 },
  ',': { key: ',', code: 'Comma', keyCode: 188 },
  '<': { key: '<', code: 'Comma', keyCode: 188 },
  '.': { key: '.', code: 'Period', keyCode: 190 },
  '>': { key: '>', code: 'Period', keyCode: 190 },
  '/': { key: '/', code: 'Slash', keyCode: 191 },
  '?': { key: '?', code: 'Slash', keyCode: 191 }
}

export function charToKeyInfo(ch: string): KeyInfo | undefined {
  if (ch.length !== 1) return undefined
  if (ch === '\n' || ch === '\r') return { key: 'Enter', code: 'Enter', keyCode: 13 }
  if (ch === '\t') return { key: 'Tab', code: 'Tab', keyCode: 9 }
  if (ch === ' ') return { key: ' ', code: 'Space', keyCode: 32 }
  if (ch >= 'a' && ch <= 'z') return { key: ch, code: 'Key' + ch.toUpperCase(), keyCode: ch.toUpperCase().charCodeAt(0) }
  if (ch >= 'A' && ch <= 'Z') return { key: ch, code: 'Key' + ch, keyCode: ch.charCodeAt(0) }
  if (ch >= '0' && ch <= '9') return { key: ch, code: 'Digit' + ch, keyCode: ch.charCodeAt(0) }
  return PUNCTUATION[ch]
}

export function namedKeyInfo(name: string): KeyInfo {
  const named = NAMED_KEYS[name.toLowerCase()]
  if (named) return named
  if (name.length === 1) return charToKeyInfo(name) ?? { key: name, code: '', keyCode: 0 }
  return { key: name, code: name, keyCode: 0 }
}

export function keyText(key: string): string | undefined {
  if (key === 'Enter') return '\r'
  if (key === 'Tab') return '\t'
  if (key === ' ') return ' '
  if (key.length === 1) return key
  return undefined
}

export interface KeyChord {
  modifiers: number
  info: KeyInfo
}

export function modifierBitForKey(key: string): number {
  return MODIFIER_BITS[key.toLowerCase()] ?? 0
}

export function parseKeyChord(chord: string): KeyChord {
  const parts = chord.split('+')
  if (parts.length < 2) return { modifiers: 0, info: namedKeyInfo(chord) }
  let modifiers = 0
  const keyParts: string[] = []
  for (const part of parts) {
    const bit = MODIFIER_BITS[part.toLowerCase()]
    if (bit) modifiers |= bit
    else keyParts.push(part)
  }
  if (modifiers === 0) return { modifiers: 0, info: namedKeyInfo(chord) }
  const key = keyParts.length ? keyParts.join('+') : chord
  return { modifiers, info: namedKeyInfo(key) }
}
