import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Tree from 'rc-tree'
import type RcTree from 'rc-tree/lib/Tree'
import type { DataNode, Key } from 'rc-tree/lib/interface'
import { useTheme } from 'next-themes'
import { FileIcon } from '@renderer/components/file-icon/file-icon'
import { initialExpandedKeys } from './workspace-tree-state'

interface WorkspaceTreeProps {
  changesOnly: boolean
  entries: DataNode[]
  gitDecorations: Map<string, string>
  onOpen(file: string): void
  onToggle(directory: DataNode): Promise<void>
  revealPath?: string | null
}

const findNode = (
  entries: DataNode[],
  key: string,
  parents: Key[] = []
): { parents: Key[]; path: string } | undefined => {
  for (const entry of entries) {
    if (String(entry.key) === key) return { parents, path: key }
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
    const nodeWidth = depth * 20 + textWidth + 38
    const childWidth =
      entry.children && expandedKeys.has(entry.key)
        ? measureTreeWidth(entry.children, expandedKeys, depth + 1)
        : 0
    return Math.max(width, nodeWidth, childWidth)
  }, 0)

export function WorkspaceTree({ changesOnly, ...props }: WorkspaceTreeProps): React.JSX.Element {
  return (
    <WorkspaceTreeContent
      key={changesOnly ? 'changes' : 'all'}
      changesOnly={changesOnly}
      {...props}
    />
  )
}

function WorkspaceTreeContent({
  changesOnly,
  entries,
  gitDecorations,
  onOpen,
  onToggle,
  revealPath
}: WorkspaceTreeProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<RcTree<DataNode>>(null)
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(() =>
    initialExpandedKeys(entries, changesOnly)
  )
  const initialized = useRef(!changesOnly || entries.length > 0)
  const [revealState, setRevealState] = useState({ dismissed: false, path: revealPath })
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([])
  const [size, setSize] = useState({ height: 0, width: 0 })

  if (revealState.path !== revealPath) {
    setRevealState({ dismissed: false, path: revealPath })
  }

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    setSize({ height: container.clientHeight, width: container.clientWidth })
    const observer = new ResizeObserver(([entry]) =>
      setSize({ height: entry.contentRect.height, width: entry.contentRect.width })
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (initialized.current || entries.length === 0) return
    initialized.current = true
    setExpandedKeys(initialExpandedKeys(entries, changesOnly))
  }, [changesOnly, entries])

  const revealed = useMemo(() => {
    if (!revealPath) return undefined
    return findNode(entries, revealPath)
  }, [entries, revealPath])

  const revealActive = revealed && !revealState.dismissed
  const visibleExpandedKeys = revealActive
    ? [...new Set([...expandedKeys, ...revealed.parents])]
    : expandedKeys
  const visibleSelectedKeys = revealActive ? [revealed.path] : selectedKeys
  const contentWidth = measureTreeWidth(entries, new Set(visibleExpandedKeys))
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
            treeData={entries}
            virtual
            loadData={onToggle}
            switcherIcon={<span className="block size-3.5" />}
            titleRender={(node) => (
              <TreeTitle
                node={node}
                gitDecorations={gitDecorations}
                light={light}
                open={visibleExpandedKeys.includes(node.key)}
              />
            )}
            onExpand={(keys) => {
              setRevealState({ dismissed: true, path: revealPath })
              setExpandedKeys(keys)
            }}
            onSelect={(keys, { node }) => {
              setRevealState({ dismissed: true, path: revealPath })
              setSelectedKeys(keys)
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
  const path = String(node.key)
  return (
    <span className="flex items-center gap-1" title={path}>
      <FileIcon expanded={open} kind={node.isLeaf ? 'file' : 'folder'} light={light} name={name} />
      <span style={{ color: gitDecorations.get(path) }}>{name}</span>
    </span>
  )
}
