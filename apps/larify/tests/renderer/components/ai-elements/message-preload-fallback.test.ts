// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const highlight = vi.hoisted(() => vi.fn())

vi.mock('@streamdown/code', () => ({
  code: {
    name: 'shiki',
    type: 'code-highlighter',
    getSupportedLanguages: () => ['text'],
    getThemes: () => ['github-light', 'github-dark'],
    highlight,
    supportsLanguage: () => true
  }
}))

import { MessageResponse } from '../../../../src/renderer/src/components/ai-elements/message'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('MessageResponse syntax-highlighter preload fallback', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses a timer when requestIdleCallback is unavailable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(createElement(MessageResponse, null, 'hello')))
    expect(highlight).not.toHaveBeenCalled()

    await act(async () => vi.runAllTimers())
    expect(highlight).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })
})
