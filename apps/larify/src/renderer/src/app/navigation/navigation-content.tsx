import { useState } from 'react'
import {
  BookOpenIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  BoxIcon,
  MessageCirclePlusIcon,
  type LucideIcon
} from 'lucide-react'

interface WorkspacePreview {
  name: string
  sessions: string[]
}

const workspaces: WorkspacePreview[] = [
  { name: 'larify-desktop', sessions: ['重构渲染器布局', '检查插件架构'] },
  { name: '音频采集', sessions: ['设计 BLE 音频流程', '验证设备连接'] }
]

function NavigationAction({
  icon: Icon,
  children,
  iconClassName = 'size-[18px]'
}: {
  icon: LucideIcon
  children: string
  iconClassName?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="grid h-8 w-full grid-cols-[20px_max-content] items-center justify-items-start gap-1 rounded-md px-3 text-left text-sm text-foreground hover:bg-sidebar-accent"
    >
      <Icon className={`${iconClassName} shrink-0`} />
      <span>{children}</span>
    </button>
  )
}

function Workspace({ workspace }: { workspace: WorkspacePreview }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const Folder = expanded ? FolderOpenIcon : FolderClosedIcon

  return (
    <section className="space-y-1">
      <button
        type="button"
        aria-expanded={expanded}
        className="grid h-8 w-full grid-cols-[20px_max-content] items-center justify-items-start gap-1 rounded-md px-3 text-left text-sm font-medium text-foreground hover:bg-sidebar-accent"
        onClick={() => setExpanded((value) => !value)}
      >
        <Folder className="size-[18px] shrink-0" />
        <span className="truncate">{workspace.name}</span>
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {workspace.sessions.map((session) => (
            <button
              key={session}
              type="button"
              className="grid h-7 w-full grid-cols-[20px_max-content] items-center justify-items-start gap-1 rounded-md px-3 text-left text-sm text-foreground hover:bg-sidebar-accent"
            >
              <span aria-hidden="true" />
              <span className="truncate">{session}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function NavigationContent(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col pb-2">
      <nav aria-label="全局入口" className="space-y-1">
        <NavigationAction icon={MessageCirclePlusIcon}>新建任务</NavigationAction>
        <NavigationAction icon={BoxIcon}>百宝箱</NavigationAction>
        <NavigationAction icon={BookOpenIcon} iconClassName="size-[17px]">知识库</NavigationAction>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="mt-1 mb-1 flex h-8 items-center px-3 text-sm font-medium text-muted-foreground">
          工作空间
        </h2>
        <div className="space-y-2">
          {workspaces.map((workspace) => (
            <Workspace key={workspace.name} workspace={workspace} />
          ))}
          <Workspace workspace={{ name: '默认空间', sessions: [] }} />
        </div>
      </div>
    </div>
  )
}
