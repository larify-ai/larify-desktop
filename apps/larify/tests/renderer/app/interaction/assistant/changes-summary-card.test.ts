// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { requestChangesNavigation, requestWorkspaceNavigation } = vi.hoisted(() => ({
  requestChangesNavigation: vi.fn(),
  requestWorkspaceNavigation: vi.fn()
}))

vi.mock('../../../../../src/extensions/workspace/renderer/changes/changes-navigation', () => ({
  // Mirrors the real resolve: relative target or inside root → root; otherwise
  // the target's own directory.
  changesRootForFile: (root: string, file: string) => {
    if (!/^(?:[a-z]:[\\/]|\\\\)/i.test(file)) return root
    if (file.startsWith(`${root}\\`) || file.startsWith(`${root}/`)) return root
    const parts = file.split(/[\\/]/)
    parts.pop()
    return parts.join('\\')
  },
  requestChangesNavigation
}))

vi.mock('../../../../../src/extensions/workspace/renderer/workspace-navigation', () => ({
  // Mirrors the real resolve: .larify/memory|tasks anchor → that root; else the
  // file's own directory (the file is always outside the card root here).
  workspaceRootForFile: (_base: string, file: string) => {
    const anchor = /^(.+[\\/]\.larify[\\/](?:memory|tasks))(?:[\\/]|$)/i.exec(file)?.[1]
    if (anchor) return anchor
    const parts = file.split(/[\\/]/)
    parts.pop()
    return parts.join('\\')
  },
  requestWorkspaceNavigation
}))

vi.mock('../../../../../src/renderer/src/app/interaction/assistant/review-hover-diff', () => ({
  ReviewHoverDiff: ({ file }: { file: { path: string } }) =>
    createElement('div', { 'data-testid': 'hover-diff' }, file.path)
}))

import {
  ChangesSummaryCard,
  HIDE_DELAY,
  HOVER_DELAY
} from '../../../../../src/renderer/src/app/interaction/assistant/changes-summary-card'

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
    requestWorkspaceNavigation.mockClear()
    window.addEventListener('larify:workbench-open', captureOpen)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  it('caps the file list at exactly five rows', async () => {
    await render()

    const list = container.querySelector('section > div')
    expect(list?.classList).toContain('max-h-[calc(9.5rem+1px)]')
    expect(list?.querySelector('button')?.classList).toContain('h-7')
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

  it('opens an out-of-root file as full text, anchored at its larify root for tasks/memory', async () => {
    const cases = [
      { path: 'E:\\other\\outside.ts', root: 'E:\\other' },
      { path: 'C:\\Users\\me\\.larify\\tasks\\demo\\task.md', root: 'C:\\Users\\me\\.larify\\tasks' }
    ]
    for (const { path, root: expectedRoot } of cases) {
      await act(async () => {
        root.render(
          createElement(ChangesSummaryCard, {
            additions: 1,
            deletions: 0,
            files: [{ additions: 1, deletions: 0, patch: '+x', path }],
            root: 'D:\\repo'
          })
        )
      })

      act(() => container.querySelectorAll('button')[1].click())
      expect(openRequest?.rendererId).toBe('workspace')
      expect(openRequest?.options).toEqual({ root: expectedRoot })
      act(() => openRequest?.onOpen?.(42))
      expect(requestWorkspaceNavigation).toHaveBeenCalledWith({ path, resourceId: 42 })
      expect(requestChangesNavigation).not.toHaveBeenCalled()
      requestWorkspaceNavigation.mockClear()
    }
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
    vi.useFakeTimers()
    await render()

    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!
    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(HOVER_DELAY)
    })

    expect(container.querySelector('[data-testid="hover-diff"]')?.textContent).toBe('a.ts')
    vi.useRealTimers()
  })

  it('shows a diff preview while focusing a file row', async () => {
    await render()

    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('a.ts')
    )!
    act(() => row.focus())

    expect(container.querySelector('[data-testid="hover-diff"]')?.textContent).toBe('a.ts')
  })

  it('places the preview below the card when the viewport clips the space above it', async () => {
    vi.useFakeTimers()
    await render()
    const card = container.querySelector<HTMLElement>('.relative.mt-3')!
    container.setAttribute('data-message-scroll-viewport', '')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      bottom: 700,
      height: 700,
      left: 0,
      right: 900,
      top: 0,
      width: 900,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      bottom: 180,
      height: 100,
      left: 0,
      right: 900,
      top: 80,
      width: 900,
      x: 0,
      y: 80,
      toJSON: () => ({})
    })

    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.querySelector?.('[data-testid="hover-diff"]')) {
        return {
          bottom: 0,
          height: 320,
          left: 0,
          right: 900,
          top: -320,
          width: 900,
          x: 0,
          y: -320,
          toJSON: () => ({})
        }
      }
      return originalRect.call(this)
    })
    hoverRow('a.ts')
    const preview = container.querySelector<HTMLElement>('[data-testid="hover-diff"]')!.parentElement!

    expect(preview.classList).toContain('top-full')
    expect(preview.classList).not.toContain('bottom-full')
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
      vi.advanceTimersByTime(HIDE_DELAY)
    })

    expect(hoverDiff()).toBeUndefined()
    outside.remove()
  })

  it('keeps the preview open while the card or conversation scrolls', async () => {
    vi.useFakeTimers()
    await render()
    const row = hoverRow('a.ts')
    const list = row.parentElement!

    act(() => {
      list.dispatchEvent(new Event('scroll'))
      document.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    })

    expect(hoverDiff()).toBe('a.ts')
    expect(list.hasAttribute('data-message-local-scroll')).toBe(true)
    expect(list.classList).toContain('overscroll-contain')
  })

  it('repositions an open preview when the conversation scrolls', async () => {
    vi.useFakeTimers()
    await render()
    container.setAttribute('data-message-scroll-viewport', '')
    const card = container.querySelector<HTMLElement>('.relative.mt-3')!
    let cardTop = 500
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 700))
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => rect(cardTop, 100))
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.querySelector?.('[data-testid="hover-diff"]')) return rect(0, 320)
      return originalRect.call(this)
    })

    hoverRow('a.ts')
    const preview = container.querySelector<HTMLElement>('[data-testid="hover-diff"]')!.parentElement!
    expect(preview.classList).toContain('bottom-full')

    cardTop = 80
    act(() => container.dispatchEvent(new Event('scroll')))
    expect(preview.classList).toContain('top-full')
  })

  it('drops the preview when the active file disappears', async () => {
    vi.useFakeTimers()
    await render()
    const row = hoverRow('a.ts')

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

  it('keeps the preview when streaming updates the hovered file', async () => {
    vi.useFakeTimers()
    await render()
    hoverRow('a.ts')
    expect(hoverDiff()).toBe('a.ts')

    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 3,
          deletions: 1,
          files: files.map((file) => ({ ...file })),
          root: 'D:\\repo'
        })
      )
    })

    expect(hoverDiff()).toBe('a.ts')
  })

  it('keeps the preview when streaming recreates unchanged change data', async () => {
    vi.useFakeTimers()
    await render()
    hoverRow('a.ts')
    expect(hoverDiff()).toBe('a.ts')

    await act(async () => {
      root.render(
        createElement(ChangesSummaryCard, {
          additions: 2,
          deletions: 1,
          files: files.map((file) => ({ ...file })),
          root: 'D:\\repo'
        })
      )
    })

    expect(hoverDiff()).toBe('a.ts')
  })

  const hoverDiff = (): string | undefined =>
    container.querySelector('[data-testid="hover-diff"]')?.textContent

  const hoverRow = (path: string, advance = HOVER_DELAY): HTMLElement => {
    const row = rowFor(path)
    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      if (advance) vi.advanceTimersByTime(advance)
    })
    return row
  }

  const rowFor = (path: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes(path)
    )!

  const rect = (top: number, height: number): DOMRect =>
    ({
      bottom: top + height,
      height,
      left: 0,
      right: 900,
      top,
      width: 900,
      x: 0,
      y: top,
      toJSON: () => ({})
    }) as DOMRect

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
    hoverRow('b.ts', 0)
    expect(hoverDiff()).toBe('c.ts')

    act(() => vi.advanceTimersByTime(150))
    expect(hoverDiff()).toBe('b.ts')
    vi.useRealTimers()
  })

  it('switches the diff when hovering another file after moving down', async () => {
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
    hoverRow('b.ts', 0)
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
