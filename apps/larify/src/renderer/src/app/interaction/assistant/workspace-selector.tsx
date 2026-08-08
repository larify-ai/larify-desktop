import { useEffect, useState } from 'react'
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { uniqueWorkspaces, workspaceName } from './workspace'

interface WorkspaceSelectorProps {
  cwd: string
  disabled: boolean
  onChange: (cwd: string) => void
}

export function WorkspaceSelector({
  cwd,
  disabled,
  onChange
}: WorkspaceSelectorProps): React.JSX.Element {
  const [recent, setRecent] = useState<string[]>([])
  const workspaces = uniqueWorkspaces([cwd, '', ...recent])

  useEffect(() => {
    let active = true
    void window.bridge
      .invoke('session:cwds')
      .then((paths) => {
        if (active) {
          setRecent(Array.isArray(paths) ? paths.filter((path) => typeof path === 'string') : [])
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const selectDirectory = async (): Promise<void> => {
    const paths = await window.bridge.invoke('dialog:pick-directories').catch(() => [])
    const path = Array.isArray(paths) ? paths[0] : undefined
    if (typeof path === 'string' && path) onChange(path)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          title={cwd || '默认空间'}
          className="flex h-10 max-w-full items-center gap-1.5 px-3 text-left text-sm text-foreground outline-none disabled:cursor-default disabled:opacity-70"
        >
          <FolderIcon className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{workspaceName(cwd)}</span>
          {!disabled && <ChevronDownIcon className="size-3.5 shrink-0" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={5}
        alignOffset={-1}
        className="w-72 rounded-2xl"
      >
        {workspaces.map((path) => (
          <DropdownMenuItem
            key={path}
            onSelect={() => onChange(path)}
            title={path}
            className="rounded-lg text-sm font-normal"
          >
            <FolderIcon className="size-4 text-foreground" />
            <span className="truncate">{workspaceName(path)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void selectDirectory()}
          className="rounded-lg text-sm font-normal"
        >
          <FolderPlusIcon className="size-4 text-foreground" />
          选择其他目录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
