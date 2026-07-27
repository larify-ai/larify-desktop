import { forwardRef, useEffect, useRef, useState, type HTMLProps } from 'react'
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist'
import { ChevronRightIcon, CircleAlertIcon, GitBranchIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { WorkspaceEntry } from '../shared/types'
import { getWorkspaceIcon } from './workspace-icon-theme'
import { findTreeEntryPath } from './workspace-tree-path'
import { initialOpenState } from './workspace-tree-state'

export interface TreeEntry extends WorkspaceEntry {
  children?: TreeEntry[]
  loaded?: boolean
  root?: boolean
}

interface WorkspaceTreeProps {
  changesOnly: boolean
  entries: TreeEntry[]
  gitAvailable: boolean
  gitDecorations: Map<string, string>
  onOpen(file: string): void
  onToggle(directory: TreeEntry): void
  onToggleView(): void
  revealPath?: string | null
}

export function WorkspaceTree({
  changesOnly,
  entries,
  gitAvailable,
  gitDecorations,
  onOpen,
  onToggle,
  onToggleView,
  revealPath
}: WorkspaceTreeProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeApi<TreeEntry> | undefined>(undefined)
  const [size, setSize] = useState({ height: 0, width: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ height: entry.contentRect.height, width: entry.contentRect.width })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const tree = treeRef.current
    if (!revealPath || !tree) return
    const path = findTreeEntryPath(entries, revealPath)
    if (!path || !tree.get(path)) return
    tree.openParents(path)
    tree.select(path, { align: 'smart', focus: false })
  }, [entries, revealPath])

  const treeVisible = size.height > 0 && size.width > 0
  return (
    <div
      className={`workspace-tree relative flex min-h-0 flex-1 flex-col ${
        resolvedTheme === 'dark' ? 'vs-dark' : 'vs'
      }`}
    >
      <button
        aria-label={changesOnly ? '切换到全局视图' : '切换到变更视图'}
        className={`absolute right-4 top-1 z-10 grid size-6 place-items-center rounded-sm hover:bg-accent ${
          changesOnly ? 'bg-accent' : ''
        }`}
        title={changesOnly ? '变更视图' : '全局视图'}
        type="button"
        onClick={onToggleView}
      >
        <GitBranchIcon className="size-3.5" />
      </button>
      <div ref={containerRef} className="min-h-0 flex-1">
        <div
          className="show-file-icons h-full"
          style={{ visibility: treeVisible ? 'visible' : 'hidden' }}
        >
          <Tree<TreeEntry>
            key={changesOnly ? 'changes' : 'all'}
            ref={treeRef}
            data={entries}
            disableDrag
            disableDrop
            height={Math.max(size.height, 1)}
            idAccessor="path"
            indent={14}
            initialOpenState={initialOpenState(entries, changesOnly)}
            openByDefault={false}
            rowHeight={24}
            width={Math.max(size.width, 1)}
            outerElementType={TreeScrollContainer}
            onActivate={(node) => {
              if (node.data.kind === 'file') onOpen(node.data.path)
            }}
            onToggle={(id) => {
              const entry = treeRef.current?.get(id)?.data
              if (entry?.kind === 'directory' && !entry.loaded) onToggle(entry)
            }}
          >
            {(props) => (
              <TreeNode
                {...props}
                gitAvailable={gitAvailable}
                gitDecorations={gitDecorations}
                light={resolvedTheme !== 'dark'}
              />
            )}
          </Tree>
        </div>
      </div>
    </div>
  )
}

const TreeScrollContainer = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  function TreeScrollContainer({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={`${className ?? ''} workspace-tree-scroll`} />
  }
)

function TreeNode({
  node,
  style,
  gitAvailable,
  gitDecorations,
  light
}: NodeRendererProps<TreeEntry> & {
  gitDecorations: Map<string, string>
  gitAvailable: boolean
  light: boolean
}): React.JSX.Element {
  const directory = node.data.kind === 'directory'
  const icon = getWorkspaceIcon(node.data.name, directory ? 'folder' : 'file', node.isOpen, light)
  return (
    <div
      style={style}
      className={`workspace-tree-row flex cursor-default items-center gap-1 overflow-hidden px-1 text-sm ${
        node.isSelected ? 'bg-accent' : ''
      }`}
      onClick={() => (directory ? node.toggle() : node.activate())}
    >
      {directory ? (
        <ChevronRightIcon
          className={`monaco-tl-twistie collapsible size-3.5 shrink-0 transition-transform ${
            node.isOpen ? 'rotate-90' : 'collapsed'
          }`}
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className="monaco-tl-contents flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {icon.url ? (
          <img aria-hidden className="workspace-tree-icon" src={icon.url} />
        ) : (
          <span
            aria-hidden
            className="workspace-tree-icon workspace-tree-font-icon"
            style={{ color: icon.color }}
          >
            {icon.character}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate" style={{ color: gitDecorations.get(node.data.path) }}>
          {node.data.name}
        </span>
        {node.data.root && !gitAvailable ? (
          <CircleAlertIcon
            aria-label="Git 状态不可用"
            className="mr-1 size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
      </span>
    </div>
  )
}
