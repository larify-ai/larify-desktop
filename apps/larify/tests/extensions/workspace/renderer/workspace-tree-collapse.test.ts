// @vitest-environment jsdom
// 守门：目录树数据随改动重建时，新增目录应自动展开，且不覆盖用户手动折叠。

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataNode, Key } from 'rc-tree/lib/interface'
import { WorkspaceTree } from '../../../../src/extensions/workspace/renderer/explorer/workspace-tree'

const treeProps = vi.hoisted(() => ({
  current: undefined as
    { expandedKeys: Key[]; treeData: DataNode[]; onExpand(keys: Key[]): void } | undefined
}))

vi.mock('rc-tree', () => ({
  default: (props: {
    expandedKeys: Key[]
    treeData: DataNode[]
    onExpand(keys: Key[]): void
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
const file = (path: string): DataNode => ({
  isLeaf: true,
  key: path,
  title: path.split('/').at(-1) ?? path
})

describe('WorkspaceTree 展开态跟随数据', () => {
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
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    treeProps.current = undefined
  })

  function render(entries: DataNode[]): void {
    act(() =>
      root.render(
        createElement(WorkspaceTree, {
          changesOnly: true,
          entries,
          gitDecorations: new Map(),
          onOpen: () => undefined,
          onToggle: async () => undefined
        })
      )
    )
  }

  it('自动展开改动后新出现的目录', () => {
    render([directory('/workspace', [directory('/workspace/src', [file('/workspace/src/a.ts')])])])

    render([
      directory('/workspace', [
        directory('/workspace/src', [file('/workspace/src/a.ts')]),
        directory('/workspace/docs', [file('/workspace/docs/readme.md')])
      ])
    ])

    expect(treeProps.current?.expandedKeys).toContain('/workspace/docs')
    expect(treeProps.current?.expandedKeys).toContain('/workspace/src')
  })

  it('自动展开改动后新出现的深层目录', () => {
    render([directory('/workspace', [directory('/workspace/src', [file('/workspace/src/a.ts')])])])

    render([
      directory('/workspace', [
        directory('/workspace/src', [
          file('/workspace/src/a.ts'),
          directory('/workspace/src/deep', [file('/workspace/src/deep/b.ts')])
        ])
      ])
    ])

    expect(treeProps.current?.expandedKeys).toContain('/workspace/src/deep')
  })

  it('不覆盖用户手动折叠过的目录', () => {
    render([directory('/workspace', [directory('/workspace/src', [file('/workspace/src/a.ts')])])])
    act(() => treeProps.current?.onExpand(['/workspace']))

    render([
      directory('/workspace', [
        directory('/workspace/src', [file('/workspace/src/a.ts')]),
        directory('/workspace/docs', [file('/workspace/docs/readme.md')])
      ])
    ])

    // 用户折叠的 /workspace/src 保持折叠；新增的 /workspace/docs 被展开。
    expect(treeProps.current?.expandedKeys).not.toContain('/workspace/src')
    expect(treeProps.current?.expandedKeys).toContain('/workspace/docs')
  })

  it('数据内容不变（仅新引用）时不改动展开状态', () => {
    const entries = [directory('/workspace', [directory('/workspace/src', [])])]
    render(entries)
    act(() => treeProps.current?.onExpand([]))
    render([directory('/workspace', [directory('/workspace/src', [])])])

    expect(treeProps.current?.expandedKeys).toEqual([])
  })
})
