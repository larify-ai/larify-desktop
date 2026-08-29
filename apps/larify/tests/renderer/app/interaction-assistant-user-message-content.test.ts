// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserMessageContent } from '../../../src/renderer/src/app/interaction/assistant/message-parts/user-message-content'
import { MessageView } from '../../../src/renderer/src/app/interaction/assistant/message-view'

describe('UserMessageContent', () => {
  let container: HTMLDivElement
  let root: Root
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('limits the visible message to three lines with a fade instead of an ellipsis', async () => {
    await render('message preview', 'complete message')
    expect(container.querySelector('[class*="max-h"]')).not.toBeNull()
    expect(container.querySelector('[class*="bg-gradient-to-b"]')).not.toBeNull()
    expect(container.textContent).not.toContain('…')
  })

  it('shows a native copy action on the message', async () => {
    await render('message preview', 'complete message')
    expect(container.querySelector('button')?.title).toBe('复制')
    expect(container.querySelector('button')?.textContent).toContain('复制')
  })

  it('copies the complete original text', async () => {
    await render('truncated preview', 'complete original message')
    await act(async () => container.querySelector('button')?.click())
    expect(writeText).toHaveBeenCalledWith('complete original message')
    expect(container.querySelector('button')?.title).toBe('复制')
  })

  it('keeps the copy action unchanged when clipboard access fails', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await render('message', 'complete message')

    await act(async () => container.querySelector('button')?.click())

    expect(writeText).toHaveBeenCalledWith('complete message')
    expect(container.querySelector('.lucide-check')).toBeNull()
    expect(container.querySelector('.lucide-copy')).not.toBeNull()
  })

  it('copies consecutive user text parts without inserting separators', async () => {
    await act(async () =>
      root.render(
        createElement(MessageView, {
          message: {
            id: 'user',
            role: 'user',
            parts: [
              { type: 'text', text: 'first' },
              { type: 'text', text: 'second' }
            ]
          }
        })
      )
    )

    await act(async () => container.querySelector('button')?.click())
    expect(writeText).toHaveBeenCalledWith('firstsecond')
  })

  it('does not read layout', async () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    await render('long message', 'long message')
    expect(scrollHeight).not.toHaveBeenCalled()
    expect(clientHeight).not.toHaveBeenCalled()
  })

  async function render(children: string, text: string): Promise<void> {
    await act(async () => root.render(createElement(UserMessageContent, { text }, children)))
  }
})
