// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserMessageContent } from '../../../src/renderer/src/app/interaction/assistant/message-parts/user-message-content'

let resize: (() => void) | undefined

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resize = () => callback([], this as unknown as ResizeObserver)
  }

  observe = vi.fn()
  disconnect = vi.fn()
}

describe('UserMessageContent', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    resize = undefined
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not show a control when the content fits', async () => {
    mockHeight(60, 60)
    await render('short message')
    expect(container.querySelector('button')).toBeNull()
  })

  it('expands and collapses content longer than three lines', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
      return this.className.includes('max-h') ? 60 : 100
    })
    await render('long message')

    const button = container.querySelector('button') as HTMLButtonElement
    const content = container.querySelector('[class*="max-h"]') as HTMLDivElement
    expect(button.getAttribute('aria-label')).toBe('展开消息')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toContain('展开')
    expect(content).not.toBeNull()

    await act(async () => button.click())
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('收起消息')
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('button')?.textContent).toContain('收起')
    expect(container.querySelector('[class*="max-h"]')).toBeNull()

    await act(async () => container.querySelector('button')?.click())
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('展开消息')
  })

  it('shows the control when resizing makes the content overflow', async () => {
    let scrollHeight = 60
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60)
    await render('responsive message')
    expect(container.querySelector('button')).toBeNull()

    scrollHeight = 100
    await act(async () => resize?.())
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('展开消息')
  })

  async function render(children: string): Promise<void> {
    await act(async () => root.render(createElement(UserMessageContent, null, children)))
  }
})

function mockHeight(scrollHeight: number, clientHeight: number): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight)
}
