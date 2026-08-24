// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { EmptyFilePreview } from '../../../../src/extensions/workspace/renderer/preview/empty-file-preview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('EmptyFilePreview', () => {
  it('renders a centered file prompt with a decorative icon', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(createElement(EmptyFilePreview)))

    expect(container.textContent).toBe('打开文件')
    expect(container.firstElementChild?.classList).toContain('gap-4')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.lucide-square-code')).not.toBeNull()

    act(() => root.unmount())
  })
})
