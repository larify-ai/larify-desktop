// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const harness = vi.hoisted(() => ({ props: vi.fn(), theme: 'dark' }))

vi.mock('@git-diff-view/react', () => ({
  DiffModeEnum: { Unified: 'unified' },
  DiffView: (props: unknown) => {
    harness.props(props)
    return createElement('div', { 'data-testid': 'diff-view' })
  }
}))
vi.mock('@git-diff-view/react/styles/diff-view.css', () => ({}))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: harness.theme }) }))

import { ReviewHoverDiff } from '../../../../../src/renderer/src/app/interaction/assistant/review-hover-diff'

const cases = [
  {
    name: 'added',
    patch: `--- /dev/null
+++ b/file.txt
@@ -0,0 +1 @@
+after
`
  },
  {
    name: 'deleted',
    patch: `--- a/file.txt
+++ /dev/null
@@ -1 +0,0 @@
-before
`
  },
  {
    name: 'modified',
    patch: `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-before
+after
`
  }
]

describe('ReviewHoverDiff', () => {
  beforeEach(() => {
    harness.props.mockClear()
    harness.theme = 'dark'
  })

  it.each(cases)('passes the complete $name Git patch to the diff renderer', async ({ patch }) => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ReviewHoverDiff, {
          file: { additions: 1, deletions: 1, patch, path: 'file.txt' }
        })
      )
    })

    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          hunks: [patch],
          newFile: { fileName: 'file.txt' },
          oldFile: { fileName: 'file.txt' }
        },
        diffViewHighlight: true,
        diffViewMode: 'unified',
        diffViewTheme: 'dark'
      })
    )
    expect(container.querySelector('.larify-file-diff')).not.toBeNull()
    expect(container.querySelector('.max-h-72.overflow-auto')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('does not claim that an empty patch contains a text diff', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ReviewHoverDiff, {
          file: { additions: 0, binary: true, deletions: 0, patch: '', path: 'image.png' }
        })
      )
    })

    expect(container.textContent).toContain('没有可预览的文本变更')
    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    expect(harness.props).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('uses the light diff theme with the application light theme', async () => {
    harness.theme = 'light'
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ReviewHoverDiff, {
          file: { additions: 1, deletions: 0, patch: cases[0].patch, path: 'file.txt' }
        })
      )
    })

    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ diffViewTheme: 'light' })
    )
    await act(async () => root.unmount())
  })

  it('keeps parsed diff input stable across theme rerenders', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const file = { additions: 1, deletions: 0, patch: cases[0].patch, path: 'file.txt' }

    await act(async () => root.render(createElement(ReviewHoverDiff, { file })))
    const firstData = (harness.props.mock.lastCall?.[0] as { data: unknown }).data
    harness.theme = 'light'
    await act(async () => root.render(createElement(ReviewHoverDiff, { file })))

    expect((harness.props.mock.lastCall?.[0] as { data: unknown }).data).toBe(firstData)
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ diffViewTheme: 'light' })
    )
    await act(async () => root.unmount())
  })

  it('does not mount an empty diff renderer when a change has no text hunk', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ReviewHoverDiff, {
          file: {
            additions: 0,
            deletions: 0,
            patch: 'old mode 100644\nnew mode 100755\n',
            path: 'script.sh'
          }
        })
      )
    })

    expect(container.textContent).toContain('没有可预览的文本变更')
    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    expect(harness.props).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
