import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Tree from 'rc-tree'
import type RcTree from 'rc-tree/lib/Tree'
import type { DataNode, Key } from 'rc-tree/lib/interface'
import { useTheme } from 'next-themes'
import { basename } from 'path-unified'
import { FileIcon } from '@renderer/components/file-icon/file-icon'
import { createWorkspaceDragData, workspaceEntryDragType } from '@renderer/lib/attachment-drag'
import {
  compactDirectoryTree,
  initialExpandedKeys,
  type CompactDirectoryNode
} from './workspace-tree-state'

interface WorkspaceTreeProps {
  changesOnly: boolean
  entries: DataNode[]
  gitDecorations: Map<string, string>
  onOpen(file: string): void
  onToggle(directory: DataNode): Promise<void>
  revealDirectory?: boolean
  revealPath?: string | null
}

const nodePath = (node: DataNode): string =>
  String((node as CompactDirectoryNode).directoryPath ?? node.key)

const findNode = (
  entries: DataNode[],
  key: string,
  parents: Key[] = []
): { parents: Key[]; path: string } | undefined => {
  for (const entry of entries) {
    const compactEntry = entry as CompactDirectoryNode
    if (
      String(entry.key) === key ||
      nodePath(entry) === key ||
      compactEntry.directoryPaths?.includes(key)
    ) {
      return { parents, path: String(entry.key) }
    }
    const child = entry.children && findNode(entry.children, key, [...parents, entry.key])
    if (child) return child
  }
  return undefined
}

const measureTreeWidth = (entries: DataNode[], expandedKeys: Set<Key>, depth = 0): number =>
  entries.reduce((width, entry) => {
    const name = String(entry.title ?? '')
    const textWidth = [...name].reduce(
      (sum, character) => sum + (character.charCodeAt(0) > 255 ? 13 : 7),
      0
    )
    const nodeWidth = depth * 14 + textWidth + 38
    const childWidth =
      entry.children && expandedKeys.has(entry.key)
        ? measureTreeWidth(entry.children, expandedKeys, depth + 1)
        : 0
    return Math.max(width, nodeWidth, childWidth)
  }, 0)

export const WorkspaceTree = memo(function WorkspaceTree({
  changesOnly,
  ...props
}: WorkspaceTreeProps): React.JSX.Element {
  return (
    <WorkspaceTreeContent
      key={changesOnly ? 'changes' : 'all'}
      changesOnly={changesOnly}
      {...props}
    />
  )
})

function WorkspaceTreeContent({
  changesOnly,
  entries,
  gitDecorations,
  onOpen,
  onToggle,
  revealDirectory = false,
  revealPath
}: WorkspaceTreeProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<RcTree<DataNode>>(null)
  const compactEntries = useMemo(() => compactDirectoryTree(entries), [entries])
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(() =>
    initialExpandedKeys(compactEntries, changesOnly)
  )
  const initialized = useRef(entries.length > 0)
  const [revealState, setRevealState] = useState({ dismissed: false, path: revealPath })
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([])
  const [size, setSize] = useState({ height: 0, width: 0 })

  if (revealState.path !== revealPath) {
    setRevealState({ dismissed: false, path: revealPath })
  }

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateSize = (height: number, width: number): void =>
      setSize((current) =>
        current.height === height && current.width === width ? current : { height, width }
      )
    updateSize(container.clientHeight, container.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      updateSize(entry.contentRect.height, entry.contentRect.width)
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (initialized.current || entries.length === 0) return
    initialized.current = true
    setExpandedKeys(initialExpandedKeys(compactEntries, changesOnly))
  }, [changesOnly, compactEntries, entries.length])

  const revealed = useMemo(() => {
    if (!revealPath) return undefined
    return findNode(compactEntries, revealPath)
  }, [compactEntries, revealPath])

  const revealActive = revealed && !revealState.dismissed
  const { visibleExpandedKeys, visibleExpandedKeySet } = useMemo(() => {
    const keys = revealActive
      ? [
          ...new Set([
            ...expandedKeys,
            ...revealed.parents,
            ...(revealDirectory ? [revealed.path] : [])
          ])
        ]
      : expandedKeys
    return { visibleExpandedKeys: keys, visibleExpandedKeySet: new Set(keys) }
  }, [expandedKeys, revealActive, revealDirectory, revealed])
  const visibleSelectedKeys = revealActive ? [revealed.path] : selectedKeys
  const contentWidth = useMemo(
    () => measureTreeWidth(compactEntries, visibleExpandedKeySet),
    [compactEntries, visibleExpandedKeySet]
  )
  const scrollWidth = size.width > 0 && contentWidth > size.width ? contentWidth : undefined

  useEffect(() => {
    if (!revealActive) return
    const frame = requestAnimationFrame(() =>
      treeRef.current?.scrollTo({ align: 'auto', key: revealed.path })
    )
    return () => cancelAnimationFrame(frame)
  }, [revealActive, revealed])

  const light = resolvedTheme !== 'dark'
  return (
    <div
      className={`workspace-tree relative flex min-h-0 flex-1 flex-col ${light ? 'vs' : 'vs-dark'}`}
    >
      <div ref={containerRef} className="min-h-0 flex-1">
        {size.height > 0 && (
          <Tree<DataNode>
            ref={treeRef}
            className="workspace-tree-scroll h-full overflow-hidden"
            expandedKeys={visibleExpandedKeys}
            expandAction="click"
            height={size.height}
            itemHeight={28}
            scrollWidth={scrollWidth}
            selectedKeys={visibleSelectedKeys}
            treeData={compactEntries}
            virtual
            loadData={(node) =>
              onToggle({
                ...node,
                key: nodePath(node)
              })
            }
            switcherIcon={<span className="block size-3.5" />}
            titleRender={(node) => (
              <TreeTitle
                node={node}
                gitDecorations={gitDecorations}
                light={light}
                open={visibleExpandedKeySet.has(node.key)}
              />
            )}
            onExpand={(keys) => {
              setRevealState({ dismissed: true, path: revealPath })
              setExpandedKeys(keys)
            }}
            onSelect={(keys, { node }) => {
              setRevealState({ dismissed: true, path: revealPath })
              setSelectedKeys(node.isLeaf ? [node.key] : keys)
              if (node.isLeaf) onOpen(String(node.key))
            }}
          />
        )}
      </div>
    </div>
  )
}

function TreeTitle({
  node,
  gitDecorations,
  light,
  open
}: {
  node: DataNode
  gitDecorations: Map<string, string>
  light: boolean
  open: boolean
}): React.JSX.Element {
  const name = String(node.title ?? '')
  const path = nodePath(node)
  const attachmentName = basename(path) || name
  return (
    <span
      className="flex items-center gap-1"
      draggable
      title={path}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(
          workspaceEntryDragType,
          createWorkspaceDragData({ directory: !node.isLeaf, name: attachmentName, path })
        )
      }}
    >
      <FileIcon expanded={open} kind={node.isLeaf ? 'file' : 'folder'} light={light} name={name} />
      <span style={{ color: gitDecorations.get(path) }}>{name}</span>
    </span>
  )
}
