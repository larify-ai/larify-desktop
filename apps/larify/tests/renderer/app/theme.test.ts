// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ThemeProvider } from '../../../src/renderer/src/app/theme/theme'

describe('ThemeProvider', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.matchMedia = () =>
      ({
        addListener: () => undefined,
        matches: false,
        removeListener: () => undefined
      }) as unknown as MediaQueryList
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders without an Electron preload bridge', async () => {
    await act(async () => {
      root.render(createElement(ThemeProvider, {}, createElement('div', {}, 'content')))
    })

    expect(container.querySelector('div')?.textContent).toBe('content')
  })
})
