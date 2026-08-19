// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskUserPart } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/ask-user-part'

describe('AskUserPart', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('submits one selected option with an optional note', async () => {
    const onSubmit = vi.fn()
    await render({
      input: {
        message: 'Choose a mode',
        options: [{ label: 'Fast' }, { label: 'Safe' }]
      },
      onSubmit
    })

    const submit = button('提交回答')
    expect(submit.type).toBe('button')
    expect(submit.disabled).toBe(true)

    await act(async () => button('Fast').click())
    await act(async () => button('Safe').click())
    await typeNote('Extra checks')
    await act(async () => submit.click())

    expect(button('Fast').getAttribute('aria-pressed')).toBe('false')
    expect(button('Safe').getAttribute('aria-pressed')).toBe('true')
    expect(onSubmit).toHaveBeenCalledWith(['Safe', 'Extra checks'])
  })

  it('does not highlight the free-text border on focus', async () => {
    await render({ input: { message: 'Anything else?' }, onSubmit: vi.fn() })

    expect(container.querySelector('textarea')?.className).toContain('focus-visible:border-input')
    expect(container.querySelector('textarea')?.className).toContain('focus-visible:ring-0')
  })

  it('supports selecting and deselecting multiple options', async () => {
    const onSubmit = vi.fn()
    await render({
      input: {
        message: 'Choose modes',
        multiple: true,
        options: [{ label: 'Fast' }, { label: 'Safe' }]
      },
      onSubmit
    })

    await act(async () => button('Fast').click())
    await act(async () => button('Safe').click())
    await act(async () => button('Fast').click())
    await act(async () => button('提交回答').click())

    expect(onSubmit).toHaveBeenCalledWith(['Safe'])
  })

  it('accepts free text without options and filters model-provided Other choices', async () => {
    const onSubmit = vi.fn()
    await render({
      input: {
        message: 'Explain the approach',
        options: [{ label: 'Other' }, { label: '其它' }]
      },
      onSubmit
    })

    expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(0)
    expect(container.querySelector('textarea')?.placeholder).toBe('请输入回答')
    await typeNote('My approach')
    await act(async () => button('提交回答').click())

    expect(onSubmit).toHaveBeenCalledWith(['My approach'])
  })

  it('renders repeated historical answers without dropping them', async () => {
    await render({
      input: { message: 'Choose a mode' },
      output: { answers: ['Safe', 'Safe'] },
      onSubmit: vi.fn()
    })

    expect(container.textContent?.match(/Safe/g)).toHaveLength(2)
    expect(container.querySelector('button')).toBeNull()
  })

  it('ignores incomplete or invalid streamed input', async () => {
    await render({
      input: { message: 'Choose modes', multiple: 'yes' },
      onSubmit: vi.fn()
    })

    expect(container.childElementCount).toBe(0)
  })

  function button(text: string): HTMLButtonElement {
    const match = [...container.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === text
    )
    if (!match) throw new Error(`Button not found: ${text}`)
    return match
  }

  async function typeNote(value: string): Promise<void> {
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        textarea,
        value
      )
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function render(props: Parameters<typeof AskUserPart>[0]): Promise<void> {
    await act(async () => root.render(createElement(AskUserPart, props)))
  }
})
