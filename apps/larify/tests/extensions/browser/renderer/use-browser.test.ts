// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowser } from '../../../../src/extensions/browser/renderer/use-browser'
import type { BrowserTabState } from '../../../../src/extensions/browser/shared/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Probe({
  onValue,
  resourceId = 42,
  sessionId = 'session-a'
}: {
  onValue(value: ReturnType<typeof useBrowser>): void
  resourceId?: number
  sessionId?: string
}): null {
  onValue(useBrowser(sessionId, resourceId))
  return null
}

describe('useBrowser', () => {
  let container: HTMLDivElement
  let root: Root
  let stateListener: (value: unknown) => void
  let invoke: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>
  let unsubscribe: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    invoke = vi.fn().mockResolvedValue(null)
    unsubscribe = vi.fn()
    on = vi.fn((_channel: string, listener: (value: unknown) => void) => {
      stateListener = listener
      return unsubscribe
    })
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        invoke,
        on
      }
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    expect(unsubscribe).toHaveBeenCalled()
    container.remove()
  })

  it('loads and follows only its resource state', async () => {
    let browser!: ReturnType<typeof useBrowser>
    await act(async () =>
      root.render(createElement(Probe, { onValue: (value) => (browser = value) }))
    )
    expect(on.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0])
    expect(invoke).toHaveBeenCalledWith('browser:getState', 'session-a', 42)

    const tab = { id: 42, title: 'OpenAI' } as BrowserTabState
    await act(async () => {
      stateListener({ sessionId: 'session-a', state: { tabs: [{ id: 7 }, tab] } })
    })
    expect(browser.state).toBe(tab)

    await act(async () => {
      stateListener({ sessionId: 'other', state: { tabs: [] } })
    })
    expect(browser.state).toBe(tab)
  })

  it('routes navigation actions with the resource id', async () => {
    let browser!: ReturnType<typeof useBrowser>
    await act(async () =>
      root.render(createElement(Probe, { onValue: (value) => (browser = value) }))
    )
    await act(async () => {
      await browser.navigate('https://openai.com')
      await browser.back()
      await browser.forward()
      await browser.reload()
    })
    expect(invoke).toHaveBeenCalledWith('browser:navigate', 'session-a', 42, 'https://openai.com')
    expect(invoke).toHaveBeenCalledWith('browser:back', 'session-a', 42)
    expect(invoke).toHaveBeenCalledWith('browser:forward', 'session-a', 42)
    expect(invoke).toHaveBeenCalledWith('browser:reload', 'session-a', 42)
  })

  it('does not let the initial request overwrite a newer state event', async () => {
    let resolveInitial!: (value: unknown) => void
    invoke.mockImplementation((channel: string) =>
      channel === 'browser:getState'
        ? new Promise((resolve) => {
            resolveInitial = resolve
          })
        : Promise.resolve(undefined)
    )
    let browser!: ReturnType<typeof useBrowser>
    await act(async () =>
      root.render(createElement(Probe, { onValue: (value) => (browser = value) }))
    )
    const current = { id: 42, title: 'Current' } as BrowserTabState
    await act(async () => {
      stateListener({ sessionId: 'session-a', state: { tabs: [current] } })
      resolveInitial({ id: 42, title: 'Stale' })
      await Promise.resolve()
    })
    expect(browser.state).toBe(current)
  })

  it('recovers through state events when the initial request fails', async () => {
    invoke.mockRejectedValueOnce(new Error('IPC unavailable'))
    let browser!: ReturnType<typeof useBrowser>
    await act(async () =>
      root.render(createElement(Probe, { onValue: (value) => (browser = value) }))
    )
    const recovered = { id: 42, title: 'Recovered' } as BrowserTabState

    await act(async () => {
      stateListener({ sessionId: 'session-a', state: { tabs: [recovered] } })
    })

    expect(browser.state).toBe(recovered)
  })

  it('ignores an initial response from the previous resource', async () => {
    let resolveOld!: (value: unknown) => void
    let resolveNew!: (value: unknown) => void
    invoke.mockImplementation(
      (_channel: string, _sessionId: string, resourceId: number) =>
        new Promise((resolve) => {
          if (resourceId === 42) resolveOld = resolve
          else resolveNew = resolve
        })
    )
    let browser!: ReturnType<typeof useBrowser>
    const onValue = (value: ReturnType<typeof useBrowser>): void => {
      browser = value
    }
    await act(async () => root.render(createElement(Probe, { onValue })))
    const oldListener = stateListener
    await act(async () => root.render(createElement(Probe, { onValue, resourceId: 43 })))
    expect(browser.state).toBeNull()
    await act(async () => {
      resolveNew({ id: 43, title: 'Current' })
      resolveOld({ id: 42, title: 'Stale' })
      oldListener({
        sessionId: 'session-a',
        state: { tabs: [{ id: 42, title: 'Stale event' }] }
      })
      await Promise.resolve()
    })

    expect(browser.state).toMatchObject({ id: 43, title: 'Current' })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('hides the previous session state before the new session responds', async () => {
    let browser!: ReturnType<typeof useBrowser>
    const onValue = (value: ReturnType<typeof useBrowser>): void => {
      browser = value
    }
    invoke
      .mockResolvedValueOnce({ id: 42, title: 'Old session' })
      .mockReturnValueOnce(new Promise(() => {}))
    await act(async () => root.render(createElement(Probe, { onValue })))
    expect(browser.state).toMatchObject({ title: 'Old session' })

    await act(async () => root.render(createElement(Probe, { onValue, sessionId: 'session-b' })))

    expect(browser.state).toBeNull()
    expect(invoke).toHaveBeenLastCalledWith('browser:getState', 'session-b', 42)
  })
})
