// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataNode, Key } from 'rc-tree/lib/interface'
import { WorkspaceTree } from '../../../../src/extensions/workspace/renderer/explorer/workspace-tree'
import { WorkbenchActivationProvider } from '../../../../src/renderer/src/app/workbench/workbench-activation'
import {
  compactDirectoryTree,
  initialExpandedKeys,
  isDirectoryLoaded,
  mergeLoadedChildren,
  updateDirectory
} from '../../../../src/extensions/workspace/renderer/explorer/workspace-tree-state'

const treeProps = vi.hoisted(() => ({
  current: undefined as
    | {
        expandedKeys: Key[]
        loadData(node: DataNode): Promise<void>
        onExpand(keys: Key[]): void
        onSelect(keys: Key[], info: { node: DataNode }): void
        selectedKeys: Key[]
        scrollWidth?: number
        titleRender(node: DataNode): React.ReactElement
        treeData: DataNode[]
      }
    | undefined
}))

vi.mock('rc-tree', () => ({
  default: (props: {
    expandedKeys: Key[]
    loadData(node: DataNode): Promise<void>
    onExpand(keys: Key[]): void
    onSelect(keys: Key[], info: { node: DataNode }): void
    selectedKeys: Key[]
    scrollWidth?: number
    titleRender(node: DataNode): React.ReactElement
    treeData: DataNode[]
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
  let onOpen: ReturnType<typeof vi.fn>
  let onToggle: ReturnType<typeof vi.fn>
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
    onOpen = vi.fn()
    onToggle = vi.fn(async () => undefined)
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

  it('expands the workspace root when global entries arrive asynchronously', () => {
    render([], undefined, false)
    expect(treeProps.current?.expandedKeys).toEqual([])

    render([directory('/workspace', [directory('/workspace/src', [])])], undefined, false)

    expect(treeProps.current?.expandedKeys).toEqual(['/workspace'])
  })

  it('expands a large changes tree', () => {
    const directories = Array.from({ length: 500 }, (_, index) =>
      directory(`/workspace/directory-${index}`, [])
    )

    render([directory('/workspace', directories)])

    expect(treeProps.current?.expandedKeys).toHaveLength(501)
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

  it('reveals a path again after navigating away and back, keeping directories expanded', () => {
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

    // reveal 展开过的目录持久化：a 与 b 都保持展开（不再反复伸缩），
    // 当前导航目标（文件本身）被选中。
    expect(treeProps.current?.expandedKeys).toEqual([
      '/workspace',
      '/workspace/b',
      '/workspace/a'
    ])
    expect(treeProps.current?.selectedKeys).toEqual(['/workspace/a/file.ts'])
  })

  it.each(['/workspace/a/b', '/workspace/a/b/c'])(
    'reveals %s when it is represented by a compact node',
    (revealPath) => {
      const entries = [
        directory('/workspace', [
          directory('/workspace/a', [
            directory('/workspace/a/b', [directory('/workspace/a/b/c', [])])
          ])
        ])
      ]

      render(entries, revealPath, false, true)

      expect(treeProps.current?.expandedKeys).toEqual(['/workspace', '/workspace/a'])
      expect(treeProps.current?.selectedKeys).toEqual(['/workspace/a'])
    }
  )

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

  it('keeps a leaf selected when the selected file is clicked again', () => {
    const file = { isLeaf: true, key: '/workspace/file.ts', title: 'file.ts' }
    render([directory('/workspace', [file])])

    act(() => treeProps.current?.onSelect([], { node: file }))

    expect(treeProps.current?.selectedKeys).toEqual(['/workspace/file.ts'])
    expect(onOpen).toHaveBeenCalledWith('/workspace/file.ts')
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

  it('observes its size only while its workbench renderer is active', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect
      }
    )
    const entries = [directory('/workspace', [])]

    render(entries, undefined, false, false, false)
    expect(observe).not.toHaveBeenCalled()
    expect(treeProps.current).toBeUndefined()

    render(entries, undefined, false, false, true)
    expect(observe).toHaveBeenCalledOnce()
    expect(treeProps.current).toBeDefined()

    render(entries, undefined, false, false, false)
    expect(disconnect).toHaveBeenCalled()
  })

  it('loads the deepest directory represented by a compact node', async () => {
    const entries = [
      directory('/workspace', [directory('/workspace/a', [directory('/workspace/a/b', [])])])
    ]
    render(entries)
    const compactNode = treeProps.current?.treeData[0].children?.[0]

    await act(async () => treeProps.current?.loadData(compactNode!))

    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ key: '/workspace/a/b' }))
  })

  it('drags a compact directory using its deepest path', () => {
    const entries = [
      directory('/workspace', [directory('/workspace/a', [directory('/workspace/a/b', [])])])
    ]
    render(entries)
    const compactNode = treeProps.current?.treeData[0].children?.[0]
    const setData = drag(compactNode!)

    expect(setData).toHaveBeenCalledWith(
      'application/x-larify-workspace-entry',
      JSON.stringify({ directory: true, name: 'b', path: '/workspace/a/b' })
    )
  })

  it('drags a file using its own path', () => {
    const file = { isLeaf: true, key: '/workspace/file.ts', title: 'file.ts' }
    render([directory('/workspace', [file])])
    const setData = drag(file)

    expect(setData).toHaveBeenCalledWith(
      'application/x-larify-workspace-entry',
      JSON.stringify({ directory: false, name: 'file.ts', path: '/workspace/file.ts' })
    )
  })

  function render(
    entries: DataNode[],
    revealPath?: string,
    changesOnly = true,
    revealDirectory = false,
    providerActive?: boolean
  ): void {
    const tree = createElement(WorkspaceTree, {
      changesOnly,
      entries,
      gitDecorations: new Map(),
      onOpen,
      onToggle,
      revealDirectory,
      revealPath
    })
    act(() =>
      root.render(
        providerActive === undefined
          ? tree
          : createElement(WorkbenchActivationProvider, { active: providerActive }, tree)
      )
    )
  }

  function drag(node: DataNode): ReturnType<typeof vi.fn> {
    const title = treeProps.current!.titleRender(node)
    const setData = vi.fn()
    const renderedTitle = (
      title.type as (props: Record<string, unknown>) => React.ReactElement<{
        onDragStart(event: {
          dataTransfer: { effectAllowed: string; setData: typeof setData }
        }): void
      }>
    )(title.props as Record<string, unknown>)
    renderedTitle.props.onDragStart({ dataTransfer: { effectAllowed: '', setData } })
    return setData
  }
})

describe('initialExpandedKeys', () => {
  it('opens the root and small directories in the changes view', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]

    expect(initialExpandedKeys(entries, true)).toEqual(['/workspace', '/workspace/src'])
  })

  it('opens large directories in the changes view', () => {
    const children = Array.from({ length: 51 }, (_, index) => ({
      isLeaf: true,
      key: `/workspace/generated/${index}.ts`,
      title: `${index}.ts`
    }))
    const entries = [directory('/workspace', [directory('/workspace/generated', children)])]

    expect(initialExpandedKeys(entries, true)).toEqual(['/workspace', '/workspace/generated'])
  })

  it('pre-expands nested directories in the changes view', () => {
    const children = [directory('/workspace/generated/nested', [])]
    children.push(
      ...Array.from({ length: 50 }, (_, index) => ({
        isLeaf: true,
        key: `/workspace/generated/${index}.ts`,
        title: `${index}.ts`
      }))
    )
    const entries = [directory('/workspace', [directory('/workspace/generated', children)])]

    expect(initialExpandedKeys(entries, true)).toEqual([
      '/workspace',
      '/workspace/generated',
      '/workspace/generated/nested'
    ])
  })

  it('opens the workspace root in the global view', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]

    expect(initialExpandedKeys(entries, false)).toEqual(['/workspace'])
  })
})

describe('workspace tree data', () => {
  it('compacts single-child directory chains below the workspace root', () => {
    const file = { isLeaf: true, key: '/workspace/a/b/c/file.ts', title: 'file.ts' }
    const entries = [
      directory('/workspace', [
        directory('/workspace/a', [
          directory('/workspace/a/b', [directory('/workspace/a/b/c', [file])])
        ])
      ])
    ]

    const compact = compactDirectoryTree(entries)

    expect(compact[0].title).toBe('workspace')
    expect(compact[0].children?.[0]).toMatchObject({
      directoryPath: '/workspace/a/b/c',
      directoryPaths: ['/workspace/a', '/workspace/a/b', '/workspace/a/b/c'],
      key: '/workspace/a',
      title: 'a / b / c',
      children: [file]
    })
  })

  it('stops compacting when a directory has multiple children', () => {
    const entries = [
      directory('/workspace', [
        directory('/workspace/src', [
          directory('/workspace/src/a', []),
          directory('/workspace/src/b', [])
        ])
      ])
    ]

    const compact = compactDirectoryTree(entries)

    expect(compact[0].children?.[0]).toMatchObject({
      key: '/workspace/src',
      title: 'src'
    })
  })

  it('treats Windows and Unicode paths as opaque keys', () => {
    const file = { isLeaf: true, key: 'D:\\项目\\源码\\页面\\首页.tsx', title: '首页.tsx' }
    const entries = [
      {
        children: [
          {
            children: [{ children: [file], key: 'D:\\项目\\源码\\页面', title: '页面' }],
            key: 'D:\\项目\\源码',
            title: '源码'
          }
        ],
        key: 'D:\\项目',
        title: '项目'
      }
    ]

    expect(compactDirectoryTree(entries)[0].children?.[0]).toMatchObject({
      directoryPath: 'D:\\项目\\源码\\页面',
      directoryPaths: ['D:\\项目\\源码', 'D:\\项目\\源码\\页面'],
      key: 'D:\\项目\\源码',
      title: '源码 / 页面',
      children: [file]
    })
  })

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
