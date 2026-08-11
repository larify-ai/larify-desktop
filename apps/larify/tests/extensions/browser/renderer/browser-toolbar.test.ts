// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserToolbar } from '../../../../src/extensions/browser/renderer/browser-toolbar'
import type { BrowserTabState } from '../../../../src/extensions/browser/shared/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const tab: BrowserTabState = {
  canGoBack: false,
  canGoForward: false,
  error: null,
  favIconUrl: '',
  id: 1,
  loading: false,
  title: '',
  url: ''
}

const enterText = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('BrowserToolbar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps invalid address text in the input when navigation is rejected', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(false),
          onReload: vi.fn(),
          tab
        })
      )
    })

    await act(async () => {
      container
        .querySelector('button:not([aria-label])')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const input = container.querySelector('input')!
    await act(async () => {
      input.focus()
      input.value = 'baidu'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()
    })

    expect(input.value).toBe('baidu')
  })

  it('reflects navigation state and invokes toolbar actions', async () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    const onReload = vi.fn()
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack,
          onForward,
          onNavigate: vi.fn().mockResolvedValue(true),
          onReload,
          tab: { ...tab, canGoBack: true, canGoForward: true }
        })
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="后退"]')!.click()
      container.querySelector<HTMLButtonElement>('button[aria-label="前进"]')!.click()
      container.querySelector<HTMLButtonElement>('button[aria-label="刷新"]')!.click()
    })

    expect(onBack).toHaveBeenCalledOnce()
    expect(onForward).toHaveBeenCalledOnce()
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('disables every control when there is no active tab', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(true),
          onReload: vi.fn(),
          tab: null
        })
      )
    })

    expect([...container.querySelectorAll('button')]).toHaveLength(4)
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true)
  })

  it('shows a simplified URL until the address is edited', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(true),
          onReload: vi.fn(),
          tab: { ...tab, url: 'https://example.com/a%20b' }
        })
      )
    })

    const address = container.querySelector<HTMLButtonElement>('[data-testid="browser-address"]')!
    expect(address.textContent).toBe('example.com/a b')
    await act(async () => address.click())
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(
      'https://example.com/a%20b'
    )
  })

  it('preserves encoded URL bytes when editing starts', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(true),
          onReload: vi.fn(),
          tab: { ...tab, url: 'https://example.com/%25' }
        })
      )
    })

    const address = container.querySelector<HTMLButtonElement>('[data-testid="browser-address"]')!
    expect(address.textContent).toBe('example.com/%')
    await act(async () => address.click())
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(
      'https://example.com/%25'
    )
  })

  it('shows a local file URL as a decoded path', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(true),
          onReload: vi.fn(),
          tab: { ...tab, url: 'file:///C:/My%20Files/index.html' }
        })
      )
    })

    const address = container.querySelector<HTMLButtonElement>('[data-testid="browser-address"]')!
    expect(address.textContent).toBe('C:/My Files/index.html')
    await act(async () => address.click())
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('C:/My Files/index.html')
  })

  it('does not navigate while an input method is composing', async () => {
    const onNavigate = vi.fn().mockResolvedValue(true)
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate,
          onReload: vi.fn(),
          tab
        })
      )
    })
    await act(async () => container.querySelector('button:not([aria-label])')!.click())

    await act(async () =>
      container
        .querySelector('input')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, isComposing: true, key: 'Enter' })
        )
    )

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('blurs the captured input after asynchronous navigation succeeds', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockResolvedValue(true),
          onReload: vi.fn(),
          tab
        })
      )
    })
    await act(async () => {
      container
        .querySelector('button:not([aria-label])')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = container.querySelector('input')!
    const blur = vi.spyOn(input, 'blur')

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()
    })

    expect(blur).toHaveBeenCalledOnce()
  })

  it('finishes editing when the accepted URL arrives before navigation resolves', async () => {
    let resolveNavigation!: (navigated: boolean) => void
    const props = {
      onBack: vi.fn(),
      onForward: vi.fn(),
      onNavigate: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveNavigation = resolve
          })
      ),
      onReload: vi.fn()
    }
    await act(async () => root.render(createElement(BrowserToolbar, { ...props, tab })))
    await act(async () => container.querySelector('button:not([aria-label])')!.click())
    const input = container.querySelector('input')!
    const blur = vi.spyOn(input, 'blur')
    await act(async () => {
      enterText(input, 'example.com')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    await act(async () =>
      root.render(
        createElement(BrowserToolbar, {
          ...props,
          tab: { ...tab, url: 'https://example.com' }
        })
      )
    )
    await act(async () => resolveNavigation(true))

    expect(blur).toHaveBeenCalledOnce()
  })

  it('ignores a navigation result after the toolbar unmounts', async () => {
    let resolveNavigation!: (navigated: boolean) => void
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: () =>
            new Promise<boolean>((resolve) => {
              resolveNavigation = resolve
            }),
          onReload: vi.fn(),
          tab
        })
      )
    })
    await act(async () => container.querySelector('button:not([aria-label])')!.click())
    const input = container.querySelector('input')!
    const blur = vi.spyOn(input, 'blur')
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    )

    await act(async () => root.render(null))
    await act(async () => resolveNavigation(true))

    expect(blur).not.toHaveBeenCalled()
  })

  it('keeps address text when asynchronous navigation rejects', async () => {
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
          onReload: vi.fn(),
          tab
        })
      )
    })
    await act(async () => {
      container
        .querySelector('button:not([aria-label])')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = container.querySelector('input')!

    await act(async () => {
      input.value = 'example.com'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()
    })

    expect(input.value).toBe('example.com')
    expect(document.activeElement).toBe(input)
  })

  it('discards the address draft when the active tab changes', async () => {
    const props = {
      onBack: vi.fn(),
      onForward: vi.fn(),
      onNavigate: vi.fn().mockResolvedValue(true),
      onReload: vi.fn()
    }
    await act(async () => {
      root.render(createElement(BrowserToolbar, { ...props, tab }))
    })
    await act(async () => {
      container
        .querySelector('button:not([aria-label])')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      const input = container.querySelector('input')!
      input.value = 'draft.example'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          ...props,
          tab: { ...tab, id: 2, url: 'https://example.com/path' }
        })
      )
    })

    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('button:not([aria-label])')?.textContent).toBe(
      'example.com/path'
    )

    await act(async () => {
      root.render(createElement(BrowserToolbar, { ...props, tab }))
    })

    expect(container.querySelector('input')).toBeNull()
  })

  it('keeps the address draft when the current page URL changes', async () => {
    const props = {
      onBack: vi.fn(),
      onForward: vi.fn(),
      onNavigate: vi.fn().mockResolvedValue(true),
      onReload: vi.fn()
    }
    await act(async () => {
      root.render(createElement(BrowserToolbar, { ...props, tab }))
    })
    await act(async () => {
      container.querySelector('button:not([aria-label])')!.click()
    })
    const input = container.querySelector('input')!
    await act(async () => enterText(input, 'draft.example'))

    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          ...props,
          tab: { ...tab, url: 'https://redirected.example' }
        })
      )
    })

    expect(container.querySelector('input')?.value).toBe('draft.example')
  })

  it('does not let an old navigation failure overwrite newer input', async () => {
    let rejectNavigation!: (reason?: unknown) => void
    const onNavigate = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectNavigation = reject
        })
    )
    await act(async () => {
      root.render(
        createElement(BrowserToolbar, {
          onBack: vi.fn(),
          onForward: vi.fn(),
          onNavigate,
          onReload: vi.fn(),
          tab
        })
      )
    })
    await act(async () => {
      container
        .querySelector('button:not([aria-label])')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = container.querySelector('input')!
    await act(async () => {
      enterText(input, 'first.example')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })
    await act(async () => {
      enterText(input, 'second.example')
    })
    await act(async () => {
      rejectNavigation(new Error('navigation failed'))
      await Promise.resolve()
    })

    expect(input.value).toBe('second.example')
  })
})
