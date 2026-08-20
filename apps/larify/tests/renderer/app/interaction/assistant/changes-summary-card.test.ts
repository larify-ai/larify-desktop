// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { requestChangesNavigation } = vi.hoisted(() => ({ requestChangesNavigation: vi.fn() }))

vi.mock('../../../../../src/extensions/workspace/renderer/changes/changes-navigation', () => ({
  changesRootForFile: (root: string, file: string) =>
    file === 'E:\\other\\outside.ts' ? 'E:\\other' : root,
  requestChangesNavigation
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

const multiFiles = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({
  additions: 1,
  deletions: 1,
  patch: `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new
`,
  path
}))

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
    vi.useRealTimers()
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

  it('opens an outside file in a scoped changes workbench', async () => {
    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 1,
          deletions: 0,
          files: [
            {
              additions: 1,
              deletions: 0,
              patch: '+outside',
              path: 'E:\\other\\outside.ts'
            }
          ],
          root: 'D:\\repo'
        })
      )
    })

    act(() => container.querySelectorAll('button')[1].click())
    expect(openRequest?.options).toEqual({ root: 'E:\\other' })
    act(() => openRequest?.onOpen?.(42))
    expect(requestChangesNavigation).toHaveBeenCalledWith({
      path: 'E:\\other\\outside.ts',
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

  it('shows a diff preview while hovering a file row', async () => {
    await render()

    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!
    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="hover-diff"]')?.textContent).toBe('a.ts')
  })

  it('shows a diff preview while focusing a file row', async () => {
    await render()

    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!
    act(() => row.focus())

    expect(container.querySelector('[data-testid="hover-diff"]')?.textContent).toBe('a.ts')
  })

  it('hides a keyboard preview after focus leaves the card', async () => {
    vi.useFakeTimers()
    await render()
    const outside = document.createElement('button')
    document.body.append(outside)
    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!

    act(() => row.focus())
    expect(hoverDiff()).toBe('a.ts')
    act(() => {
      outside.focus()
      vi.advanceTimersByTime(600)
    })

    expect(hoverDiff()).toBeUndefined()
    outside.remove()
  })

  it('drops the preview when the active file disappears', async () => {
    await render()
    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!
    act(() => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))

    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 0,
          deletions: 0,
          files: files.filter(({ binary }) => binary),
          root: 'D:\\repo'
        })
      )
    })

    expect(container.querySelector('[data-testid="hover-diff"]')).toBeNull()
  })

  const hoverDiff = (): string | undefined =>
    container.querySelector('[data-testid="hover-diff"]')?.textContent

  const hoverRow = (path: string): HTMLElement => {
    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes(path)
    )!
    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    return row
  }

  it('delays switching while moving up through rows toward the preview', async () => {
    vi.useFakeTimers()
    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 3,
          deletions: 3,
          files: multiFiles,
          root: 'D:\\repo'
        })
      )
    })
    const rootDiv = container.querySelector<HTMLElement>('.relative.mt-3')!

    // hover 最下方文件 c.ts
    hoverRow('c.ts')
    expect(hoverDiff()).toBe('c.ts')

    // 向上移动（movementY<0），途经上方的 b.ts 不应切换
    act(() => {
      rootDiv.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementY: -5 }))
    })
    hoverRow('b.ts')
    expect(hoverDiff()).toBe('c.ts')

    act(() => vi.advanceTimersByTime(150))
    expect(hoverDiff()).toBe('b.ts')
    vi.useRealTimers()
  })

  it('switches the diff when hovering another file after moving down', async () => {
    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 3,
          deletions: 3,
          files: multiFiles,
          root: 'D:\\repo'
        })
      )
    })
    const rootDiv = container.querySelector<HTMLElement>('.relative.mt-3')!

    hoverRow('a.ts')
    expect(hoverDiff()).toBe('a.ts')

    // 向下移动（movementY>0）后 hover 下方 b.ts 应正常切换
    act(() => {
      rootDiv.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementY: 5 }))
    })
    hoverRow('b.ts')
    expect(hoverDiff()).toBe('b.ts')
  })

  it('does not switch a diff while crossing rows into the preview', async () => {
    vi.useFakeTimers()
    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 3,
          deletions: 3,
          files: multiFiles,
          root: 'D:\\repo'
        })
      )
    })
    const rootDiv = container.querySelector<HTMLElement>('.relative.mt-3')!

    hoverRow('c.ts')
    act(() => {
      rootDiv.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementY: -5 }))
    })
    hoverRow('b.ts')
    act(() => {
      container
        .querySelector<HTMLElement>('[data-testid="hover-diff"]')!
        .parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(150)
    })

    expect(hoverDiff()).toBe('c.ts')
    vi.useRealTimers()
  })
})
