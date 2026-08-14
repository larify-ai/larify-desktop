// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataNode, Key } from 'rc-tree/lib/interface'
import { WorkspaceTree } from '../../../../src/extensions/workspace/renderer/explorer/workspace-tree'
import {
  initialExpandedKeys,
  isDirectoryLoaded,
  mergeLoadedChildren,
  updateDirectory
} from '../../../../src/extensions/workspace/renderer/explorer/workspace-tree-state'

const treeProps = vi.hoisted(() => ({
  current: undefined as
    { expandedKeys: Key[]; onExpand(keys: Key[]): void; scrollWidth?: number } | undefined
}))

vi.mock('rc-tree', () => ({
  default: (props: {
    expandedKeys: Key[]
    onExpand(keys: Key[]): void
    scrollWidth?: number
  }): React.JSX.Element => {
    treeProps.current = props
    return createElement('div')
  }
}))

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
vi.mock('@renderer/components/file-icon/file-icon', () => ({
  FileIcon: () => createElement('span')
}))

const directory = (path: string, children: DataNode[]): DataNode => ({
  children,
  key: path,
  title: path.split('/').at(-1) ?? path
})

describe('WorkspaceTree', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {
          return undefined
        }
        disconnect(): void {
          return undefined
        }
      }
    )
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    treeProps.current = undefined
  })

  it('expands a changes tree when its entries arrive asynchronously', () => {
    render([])
    expect(treeProps.current?.expandedKeys).toEqual([])

    render([directory('/workspace', [directory('/workspace/src', [])])])
    expect(treeProps.current?.expandedKeys).toEqual(['/workspace', '/workspace/src'])
  })

  it('does not override the user expansion state after initialization', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]
    render(entries)
    act(() => treeProps.current?.onExpand([]))

    render([...entries])
    expect(treeProps.current?.expandedKeys).toEqual([])
  })

  it('allows a revealed directory to be collapsed again', () => {
    const file = { isLeaf: true, key: '/workspace/src/file.ts', title: 'file.ts' }
    const entries = [directory('/workspace', [directory('/workspace/src', [file])])]
    render(entries, '/workspace/src/file.ts')
    expect(treeProps.current?.expandedKeys).toEqual(['/workspace', '/workspace/src'])

    act(() => treeProps.current?.onExpand([]))
    expect(treeProps.current?.expandedKeys).toEqual([])
  })

  it('reveals a path again after navigating away and back', () => {
    const first = { isLeaf: true, key: '/workspace/a/file.ts', title: 'file.ts' }
    const second = { isLeaf: true, key: '/workspace/b/file.ts', title: 'file.ts' }
    const entries = [
      directory('/workspace', [
        directory('/workspace/a', [first]),
        directory('/workspace/b', [second])
      ])
    ]

    render(entries, String(first.key))
    act(() => treeProps.current?.onExpand([]))
    render(entries, String(second.key))
    render(entries, String(first.key))

    expect(treeProps.current?.expandedKeys).toEqual(['/workspace', '/workspace/a'])
  })

  it('does not scroll back to a dismissed reveal after the tree refreshes', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const file = { isLeaf: true, key: '/workspace/src/file.ts', title: 'file.ts' }
    const entries = [directory('/workspace', [directory('/workspace/src', [file])])]

    render(entries, String(file.key))
    expect(requestFrame).toHaveBeenCalledTimes(1)
    act(() => treeProps.current?.onExpand([]))
    render([...entries], String(file.key))

    expect(requestFrame).toHaveBeenCalledTimes(1)
  })

  it('does not enable horizontal scrolling when the tree is narrower than its container', () => {
    render([directory('/workspace', [])])

    expect(treeProps.current?.scrollWidth).toBeUndefined()
  })

  it('enables horizontal scrolling when the tree is wider than its container', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80)
    render([directory('/workspace-with-a-long-directory-name', [])])

    expect(treeProps.current?.scrollWidth).toBeGreaterThan(80)
  })

  function render(entries: DataNode[], revealPath?: string): void {
    act(() =>
      root.render(
        createElement(WorkspaceTree, {
          changesOnly: true,
          entries,
          gitDecorations: new Map(),
          onOpen: vi.fn(),
          onToggle: vi.fn(),
          revealPath
        })
      )
    )
  }
})

describe('initialExpandedKeys', () => {
  it('opens the root and small directories in the changes view', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]

    expect(initialExpandedKeys(entries, true)).toEqual(['/workspace', '/workspace/src'])
  })

  it('keeps large directories collapsed', () => {
    const children = Array.from({ length: 51 }, (_, index) => ({
      isLeaf: true,
      key: `/workspace/generated/${index}.ts`,
      title: `${index}.ts`
    }))
    const entries = [directory('/workspace', [directory('/workspace/generated', children)])]

    expect(initialExpandedKeys(entries, true)).toEqual(['/workspace'])
  })

  it('opens directories at the automatic expansion limit', () => {
    const children = Array.from({ length: 50 }, (_, index) => ({
      isLeaf: true,
      key: `/workspace/generated/${index}.ts`,
      title: `${index}.ts`
    }))
    const entries = [directory('/workspace', [directory('/workspace/generated', children)])]

    expect(initialExpandedKeys(entries, true)).toEqual(['/workspace', '/workspace/generated'])
  })

  it('does not pre-expand descendants of a collapsed directory', () => {
    const children = [directory('/workspace/generated/nested', [])]
    children.push(
      ...Array.from({ length: 50 }, (_, index) => ({
        isLeaf: true,
        key: `/workspace/generated/${index}.ts`,
        title: `${index}.ts`
      }))
    )
    const entries = [directory('/workspace', [directory('/workspace/generated', children)])]

    expect(initialExpandedKeys(entries, true)).toEqual(['/workspace'])
  })

  it('keeps directories collapsed in the global view', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]

    expect(initialExpandedKeys(entries, false)).toEqual([])
  })
})

describe('workspace tree data', () => {
  it('preserves loaded descendants when a directory is refreshed', () => {
    const loaded = directory('/workspace/src', [
      { isLeaf: true, key: '/workspace/src/file.ts', title: 'file.ts' }
    ])

    expect(mergeLoadedChildren([{ key: '/workspace/src', title: 'src' }], [loaded])).toEqual([
      loaded
    ])
  })

  it('does not preserve directory children when a path becomes a file', () => {
    const file = { isLeaf: true, key: '/workspace/item', title: 'item' }
    const directoryWithChildren = directory('/workspace/item', [
      { isLeaf: true, key: '/workspace/item/child', title: 'child' }
    ])

    expect(mergeLoadedChildren([file], [directoryWithChildren])).toEqual([file])
  })

  it('does not copy file state when a path becomes a directory', () => {
    const file = { isLeaf: true, key: '/workspace/item', title: 'item' }
    const next = directory('/workspace/item', [])

    expect(mergeLoadedChildren([next], [file])).toEqual([next])
  })

  it('keeps authoritative children supplied by the refreshed tree', () => {
    const previous = directory('/workspace/src', [
      { isLeaf: true, key: '/workspace/src/old.ts', title: 'old.ts' }
    ])
    const next = directory('/workspace/src', [
      { isLeaf: true, key: '/workspace/src/new.ts', title: 'new.ts' }
    ])

    expect(mergeLoadedChildren([next], [previous])).toEqual([next])
  })

  it('keeps removed entries removed while preserving matching directories', () => {
    const kept = directory('/workspace/kept', [
      { isLeaf: true, key: '/workspace/kept/file.ts', title: 'file.ts' }
    ])
    const removed = directory('/workspace/removed', [])

    expect(
      mergeLoadedChildren([{ key: '/workspace/kept', title: 'kept' }], [kept, removed])
    ).toEqual([kept])
  })

  it('updates a nested directory without changing its siblings', () => {
    const sibling = directory('/workspace/test', [])
    const entries = [directory('/workspace', [directory('/workspace/src', []), sibling])]
    const child = { isLeaf: true, key: '/workspace/src/file.ts', title: 'file.ts' }
    const updated = updateDirectory(entries, '/workspace/src', [child])

    expect(updated[0].children?.[0].children).toEqual([child])
    expect(updated[0].children?.[1]).toBe(sibling)
  })

  it('updates the root directory', () => {
    const entries = [directory('/workspace', [])]
    const child = { isLeaf: true, key: '/workspace/file.ts', title: 'file.ts' }

    expect(updateDirectory(entries, '/workspace', [child])[0].children).toEqual([child])
  })

  it('preserves loaded grandchildren when their parent is refreshed', () => {
    const loaded = directory('/workspace/src', [
      directory('/workspace/src/components', [
        { isLeaf: true, key: '/workspace/src/components/button.tsx', title: 'button.tsx' }
      ])
    ])
    const refreshed = updateDirectory([directory('/workspace', [loaded])], '/workspace/src', [
      { key: '/workspace/src/components', title: 'components' }
    ])

    expect(refreshed[0].children?.[0]).toEqual(loaded)
  })

  it('returns the original tree when the directory is not found', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]

    expect(updateDirectory(entries, '/other', [])).toBe(entries)
  })

  it('distinguishes unloaded and loaded empty directories', () => {
    expect(isDirectoryLoaded([directory('/workspace/src', [])], '/workspace/src')).toBe(true)
    expect(isDirectoryLoaded([{ key: '/workspace/src', title: 'src' }], '/workspace/src')).toBe(
      false
    )
  })
})
