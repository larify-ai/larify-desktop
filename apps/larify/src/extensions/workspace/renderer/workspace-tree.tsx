import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tree, type NodeRendererProps } from 'react-arborist'
import { ChevronRightIcon } from 'lucide-react'
import type { WorkspaceEntry } from '../shared/types'
import { createWorkspaceIconResolver } from './monaco'

export interface TreeEntry extends WorkspaceEntry {
  children?: TreeEntry[]
  loaded?: boolean
  root?: boolean
}

interface WorkspaceTreeProps {
  entries: TreeEntry[]
  onOpen(file: string): void
  onToggle(directory: TreeEntry): void
  rootAction?: ReactNode
}

export function WorkspaceTree({
  entries,
  onOpen,
  onToggle,
  rootAction
}: WorkspaceTreeProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [iconResolver, setIconResolver] = useState<
    ((path: string, kind: 'file' | 'folder' | 'root') => string) | null
  >(null)
  const [size, setSize] = useState({ height: 0, width: 0 })

  useEffect(() => {
    let disposed = false
    void createWorkspaceIconResolver().then((resolver) => {
      if (!disposed) setIconResolver(() => resolver)
    })
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ height: entry.contentRect.height, width: entry.contentRect.width })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="show-file-icons min-h-0 flex-1">
      {size.height > 0 && size.width > 0 ? (
        <Tree<TreeEntry>
          data={entries}
          height={size.height}
          idAccessor="path"
          indent={16}
          initialOpenState={
            entries[0]?.root ? { [entries[0].path]: true } : undefined
          }
          openByDefault={false}
          rowHeight={26}
          width={size.width}
          onActivate={(node) => {
            const entry = node.data
            if (entry?.kind === 'file') onOpen(entry.path)
          }}
          onToggle={(id) => {
            const find = (items: TreeEntry[]): TreeEntry | undefined => {
              for (const item of items) {
                if (item.path === id) return item
                const nested = item.children && find(item.children)
                if (nested) return nested
              }
              return undefined
            }
            const entry = find(entries)
            if (entry?.kind === 'directory' && !entry.loaded) onToggle(entry)
          }}
        >
          {(props) => (
            <TreeNode {...props} iconResolver={iconResolver} rootAction={rootAction} />
          )}
        </Tree>
      ) : null}
    </div>
  )
}

function TreeNode({
  node,
  style,
  dragHandle,
  iconResolver,
  rootAction
}: NodeRendererProps<TreeEntry> & {
  iconResolver: ((path: string, kind: 'file' | 'folder' | 'root') => string) | null
  rootAction?: ReactNode
}): React.JSX.Element {
  const directory = node.data.kind === 'directory'
  const iconKind = node.data.root ? 'root' : directory ? 'folder' : 'file'
  const iconClass = directory
    ? `codicon codicon-${
        node.data.root
          ? node.isOpen
            ? 'root-folder-opened'
            : 'root-folder'
          : node.isOpen
            ? 'folder-opened'
            : 'folder'
      }`
    : iconResolver?.(node.data.path, iconKind) ?? 'file-icon'

  return (
    <div
      ref={dragHandle}
      style={style}
      className="flex cursor-default items-center gap-1.5 overflow-hidden px-1 text-sm hover:bg-accent"
      onClick={() => (directory ? node.toggle() : node.activate())}
    >
      {directory ? (
        <ChevronRightIcon
          className={`size-3.5 shrink-0 transition-transform ${node.isOpen ? 'rotate-90' : ''}`}
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span
        aria-hidden
        className={`${iconClass} workspace-tree-icon`}
      />
      <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
      {node.data.root && rootAction ? (
        <span className="ml-auto shrink-0" onClick={(event) => event.stopPropagation()}>
          {rootAction}
        </span>
      ) : null}
    </div>
  )
}
