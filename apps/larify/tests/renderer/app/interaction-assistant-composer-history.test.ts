// @vitest-environment jsdom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerHistory } from '../../../src/renderer/src/app/interaction/assistant/composer-history'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0))
    return 1
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('composer history', () => {
  it('browses older input and restores the draft', async () => {
    await render(['first', 'second\nline'])
    const textarea = input()
    await type(textarea, 'draft')

    await key(textarea, 'ArrowUp')
    expect(textarea.value).toBe('second\nline')
    expect(textarea.selectionStart).toBe(0)
    await key(textarea, 'ArrowUp')
    expect(textarea.value).toBe('first')
    expect(textarea.selectionStart).toBe(0)
    await key(textarea, 'ArrowDown')
    expect(textarea.value).toBe('second\nline')
    expect(textarea.selectionStart).toBe(11)
    await key(textarea, 'ArrowDown')
    expect(textarea.value).toBe('draft')
    expect(textarea.selectionStart).toBe(5)
  })

  it('leaves arrow navigation unchanged inside multiline input', async () => {
    await render(['history'])
    const textarea = input()
    await type(textarea, 'first\nsecond')

    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    await key(textarea, 'ArrowUp')
    expect(textarea.value).toBe('first\nsecond')

    textarea.setSelectionRange(0, 0)
    await key(textarea, 'ArrowDown')
    expect(textarea.value).toBe('first\nsecond')
  })

  it('ignores modified keys and selected text', async () => {
    await render(['history'])
    const textarea = input()
    await type(textarea, 'draft')

    await key(textarea, 'ArrowUp', { ctrlKey: true })
    expect(textarea.value).toBe('draft')

    textarea.setSelectionRange(0, textarea.value.length)
    await key(textarea, 'ArrowUp')
    expect(textarea.value).toBe('draft')
  })

  it('clamps the selected index when history becomes shorter', async () => {
    await render(['first', 'second', 'third'])
    const textarea = input()
    await key(textarea, 'ArrowUp')
    expect(textarea.value).toBe('third')

    await render(['first'])
    await key(input(), 'ArrowUp')
    expect(input().value).toBe('first')
  })
})

function Harness({ history }: { history: string[] }): React.JSX.Element {
  const [value, setValue] = useState('')
  const events = useComposerHistory(history, setValue)
  return createElement('textarea', {
    value,
    onChange: events.onChange,
    onKeyDown: events.onKeyDown
  })
}

async function render(history: string[]): Promise<void> {
  await act(async () => root.render(createElement(Harness, { history })))
}

function input(): HTMLTextAreaElement {
  return container.querySelector('textarea') as HTMLTextAreaElement
}

async function type(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    textarea.value = value
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function key(
  textarea: HTMLTextAreaElement,
  value: string,
  init?: KeyboardEventInit
): Promise<void> {
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...init }))
  })
}
