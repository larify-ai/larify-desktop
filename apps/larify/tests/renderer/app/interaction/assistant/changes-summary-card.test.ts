// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { requestChangesNavigation } = vi.hoisted(() => ({ requestChangesNavigation: vi.fn() }))

vi.mock('../../../../../src/extensions/workspace/renderer/changes/changes-navigation', () => ({
  requestChangesNavigation
}))

vi.mock('../../../../../src/renderer/src/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => children,
  HoverCardContent: ({ children, side }: { children: React.ReactNode; side: string }) =>
    createElement('div', { 'data-side': side }, children),
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('../../../../../src/renderer/src/app/interaction/assistant/review-hover-diff', () => ({
  ReviewHoverDiff: ({ file }: { file: { path: string } }) =>
    createElement('div', { 'data-testid': 'hover-diff' }, file.path)
}))

import { ChangesSummaryCard } from '../../../../../src/renderer/src/app/interaction/assistant/changes-summary-card'

const files = [
  {
    additions: 1,
    deletions: 1,
    patch: `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
`,
    path: 'a.ts'
  },
  { additions: 0, binary: true, deletions: 0, patch: '', path: 'image.png' }
]

describe('ChangesSummaryCard', () => {
  let container: HTMLDivElement
  let root: Root
  let openRequest:
    | { onOpen?(resourceId: number): void; options?: Record<string, string>; rendererId: string }
    | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    requestChangesNavigation.mockClear()
    window.addEventListener('larify:workbench-open', captureOpen)
  })

  afterEach(() => {
    act(() => root.unmount())
    window.removeEventListener('larify:workbench-open', captureOpen)
    container.remove()
    openRequest = undefined
  })

  function captureOpen(event: Event): void {
    openRequest = (event as CustomEvent<typeof openRequest>).detail
  }

  const render = async ({
    workspaceRoot = 'D:\\repo'
  }: { workspaceRoot?: string | null } = {}): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 2,
          deletions: 1,
          files,
          root: workspaceRoot ?? undefined
        })
      )
    })
  }

  it('opens all changes from the card heading', async () => {
    await render()
    act(() => container.querySelector<HTMLButtonElement>('section > button')!.click())

    expect(openRequest?.rendererId).toBe('changes')
    expect(openRequest?.options).toEqual({ root: 'D:\\repo' })
    expect(openRequest?.onOpen).toBeUndefined()
    expect(requestChangesNavigation).not.toHaveBeenCalled()
  })

  it('opens all changes at the selected file', async () => {
    await render()
    const button = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!
    act(() => button.click())
    expect(requestChangesNavigation).not.toHaveBeenCalled()
    act(() => openRequest?.onOpen?.(42))

    expect(requestChangesNavigation).toHaveBeenCalledWith({
      path: 'a.ts',
      resourceId: 42
    })
  })

  it('opens a binary file in all changes too', async () => {
    await render()
    const button = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('image.png')
    )!

    act(() => button.click())
    expect(openRequest?.rendererId).toBe('changes')
    expect(openRequest?.options).toEqual({ root: 'D:\\repo' })
    act(() => openRequest?.onOpen?.(42))

    expect(requestChangesNavigation).toHaveBeenCalledWith({
      path: 'image.png',
      resourceId: 42
    })
  })

  it('keeps a relative selection for a legacy card without a root', async () => {
    await render({ workspaceRoot: null })
    const button = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!

    act(() => button.click())
    expect(openRequest?.options).toBeUndefined()
    act(() => openRequest?.onOpen?.(42))

    expect(requestChangesNavigation).toHaveBeenCalledWith({ path: 'a.ts', resourceId: 42 })
  })

  it('anchors a preview above each file row', async () => {
    await render()

    expect(
      Array.from(container.querySelectorAll('[data-testid="hover-diff"]')).map(
        (preview) => preview.textContent
      )
    ).toEqual(['a.ts'])
    expect(
      Array.from(container.querySelectorAll('[data-side]')).map((preview) =>
        preview.getAttribute('data-side')
      )
    ).toEqual(['top'])
  })
})
