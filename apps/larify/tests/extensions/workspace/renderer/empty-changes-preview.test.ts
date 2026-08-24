// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { EmptyChangesPreview } from '../../../../src/extensions/workspace/renderer/changes/empty-changes-preview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('EmptyChangesPreview', () => {
  it('presents the changes workbench action', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(createElement(EmptyChangesPreview)))

    expect(container.textContent).toBe('审查变更')
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
