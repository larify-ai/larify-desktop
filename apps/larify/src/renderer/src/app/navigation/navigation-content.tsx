import { useState } from 'react'
// 暂不显示百宝箱/知识库入口，恢复时取消注释并一并恢复下方 JSX 与测试断言
// import { BookOpenIcon, LayoutGridIcon, MessageCirclePlusIcon, PlusIcon } from 'lucide-react'
import { MessageCirclePlusIcon, PlusIcon } from 'lucide-react'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'
import { NavigationAction } from './navigation-action'
import { Workspace } from './workspace'
import { createWorkspaces } from './workspaces'

const hiddenWorkspacesKey = 'larify:hidden-workspaces'

function loadHiddenWorkspaces(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(hiddenWorkspacesKey) ?? '[]')
    return new Set(
      Array.isArray(value) ? value.filter((path) => typeof path === 'string' && path) : []
    )
  } catch {
    return new Set()
  }
}

function saveHiddenWorkspaces(paths: ReadonlySet<string>): void {
  try {
    localStorage.setItem(hiddenWorkspacesKey, JSON.stringify([...paths]))
  } catch {
    // The navigation state still works for this window when storage is unavailable.
  }
}

export function NavigationContent(): React.JSX.Element {
  const sessions = useAssistantSessions()
  const [hidden, setHidden] = useState(loadHiddenWorkspaces)
  const updateHidden = (update: (current: ReadonlySet<string>) => Set<string>): void => {
    setHidden((current) => {
      const next = update(current)
      next.delete('')
      saveHiddenWorkspaces(next)
      return next
    })
  }
  const removeWorkspace = (cwd: string): void => {
    if (cwd) updateHidden((current) => new Set([...current, cwd]))
  }
  const addWorkspace = async (): Promise<void> => {
    const paths = await window.bridge.invoke('dialog:pick-directories').catch(() => [])
    const cwd = Array.isArray(paths) ? paths[0] : undefined
    if (typeof cwd !== 'string' || !cwd) return
    updateHidden((current) => {
      const next = new Set(current)
      next.delete(cwd)
      return next
    })
    sessions.create(cwd)
  }
  const workspaces = createWorkspaces(sessions, { hidden, onRemove: removeWorkspace })

  return (
    <div className="flex h-full min-h-0 flex-col pb-2">
      <nav aria-label="全局入口" className="space-y-0.5">
        <NavigationAction icon={MessageCirclePlusIcon} onClick={() => sessions.create()}>
          新建任务
        </NavigationAction>
        {/* 暂时注释：百宝箱/知识库入口
        <NavigationAction icon={LayoutGridIcon}>百宝箱</NavigationAction>
        <NavigationAction icon={BookOpenIcon}>知识库</NavigationAction>
        */}
      </nav>

      <h2
        id="workspaces-heading"
        className="mt-0.5 mb-0.5 flex h-8 shrink-0 items-center justify-between px-3 text-sm font-medium text-muted-foreground [&:hover>button]:opacity-100"
      >
        <span>工作空间</span>
        <button
          type="button"
          aria-label="添加工作空间"
          title="添加工作空间"
          className="grid size-6 place-items-center rounded-md opacity-0 transition-[color,background-color,opacity] hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void addWorkspace()}
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </button>
      </h2>
      <nav
        aria-labelledby="workspaces-heading"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div className="space-y-0.5">
          {workspaces.map((workspace) => (
            <Workspace key={workspace.id} workspace={workspace} />
          ))}
        </div>
      </nav>
    </div>
  )
}
