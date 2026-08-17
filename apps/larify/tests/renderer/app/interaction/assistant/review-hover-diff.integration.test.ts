// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
  font: '',
  measureText: () => ({ width: 8 })
} as never)

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

import { ReviewHoverDiff } from '../../../../../src/renderer/src/app/interaction/assistant/review-hover-diff'

describe('ReviewHoverDiff integration', () => {
  const containers: HTMLDivElement[] = []

  afterEach(() => containers.splice(0).forEach((container) => container.remove()))
  afterAll(() => canvas.mockRestore())

  it('renders a persisted Git patch with the real diff component', async () => {
    const container = document.createElement('div')
    containers.push(container)
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ReviewHoverDiff, {
          file: {
            additions: 1,
            deletions: 1,
            path: 'src/file.ts',
            patch: `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1 @@
-const value = 'before'
+const value = 'after'
`
          }
        })
      )
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain("const value = 'before'")
      expect(container.textContent).toContain("const value = 'after'")
    })
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull()

    await act(async () => root.unmount())
  })
})
