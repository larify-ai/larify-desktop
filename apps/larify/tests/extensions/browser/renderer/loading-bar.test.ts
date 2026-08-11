// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanem/react-nprogress', () => ({
  useNProgress: ({ isAnimating }: { isAnimating: boolean }) => ({
    animationDuration: 200,
    isFinished: !isAnimating,
    progress: isAnimating ? 0.4 : 1
  })
}))

import { LoadingBar } from '../../../../src/extensions/browser/renderer/loading-bar'

describe('LoadingBar', () => {
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

  it('exposes and animates active loading progress', async () => {
    await act(async () => root.render(createElement(LoadingBar, { loading: true })))

    const progress = container.querySelector<HTMLElement>('[role="progressbar"]')!
    expect(progress.getAttribute('aria-hidden')).toBe('false')
    expect(progress.style.opacity).toBe('1')
    expect(progress.firstElementChild?.getAttribute('style')).toContain('width: 40%')
  })

  it('hides the finished indicator from view and assistive technology', async () => {
    await act(async () => root.render(createElement(LoadingBar, { loading: false })))

    const progress = container.querySelector<HTMLElement>('[role="progressbar"]')!
    expect(progress.getAttribute('aria-hidden')).toBe('true')
    expect(progress.style.opacity).toBe('0')
  })
})
