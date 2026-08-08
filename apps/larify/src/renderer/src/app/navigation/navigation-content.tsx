import { useState } from 'react'
import {
  BookOpenIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  BoxIcon,
  MessageCirclePlusIcon,
  type LucideIcon
} from 'lucide-react'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'

interface SessionPreview {
  id: string
  name: string
  active?: boolean
  onClick?: () => void
}

interface WorkspacePreview {
  name: string
  sessions: SessionPreview[]
}

const workspaces: WorkspacePreview[] = [
  {
    name: 'larify-desktop',
    sessions: ['重构渲染器布局', '检查插件架构'].map((name) => ({ id: name, name }))
  },
  {
    name: '音频采集',
    sessions: ['设计 BLE 音频流程', '验证设备连接'].map((name) => ({ id: name, name }))
  }
]

const navigationItem =
  'mx-1 grid w-[calc(100%-0.5rem)] grid-cols-[20px_max-content] items-center justify-items-start gap-1 rounded-lg px-2 text-left text-sm text-foreground hover:bg-sidebar-accent'

function NavigationAction({
  icon: Icon,
  children,
  iconClassName = 'size-[18px]',
  onClick
}: {
  icon: LucideIcon
  children: string
  iconClassName?: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`${navigationItem} h-8`} onClick={onClick}>
      <Icon className={`${iconClassName} shrink-0`} />
      <span>{children}</span>
    </button>
  )
}

function Workspace({ workspace }: { workspace: WorkspacePreview }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const Folder = expanded ? FolderOpenIcon : FolderClosedIcon

  return (
    <section className="space-y-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        className={`${navigationItem} h-8 font-medium`}
        onClick={() => setExpanded((value) => !value)}
      >
        <Folder className="size-[18px] shrink-0" />
        <span className="truncate">{workspace.name}</span>
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {workspace.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              aria-current={session.active ? 'page' : undefined}
              className={`${navigationItem} h-8 ${session.active ? 'bg-sidebar-accent' : ''}`}
              onClick={session.onClick}
            >
              <span aria-hidden="true" />
              <span className="truncate">{session.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function NavigationContent(): React.JSX.Element {
  const sessions = useAssistantSessions()
  const defaultWorkspace: WorkspacePreview = {
    name: '默认空间',
    sessions: sessions.sessions.flatMap((session) =>
      session.heading
        ? [
            {
              id: session.id,
              name: session.heading.title,
              active: session.id === sessions.activeId,
              onClick: () => sessions.select(session.id)
            }
          ]
        : []
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-2">
      <nav aria-label="全局入口" className="space-y-0.5">
        <NavigationAction icon={MessageCirclePlusIcon} onClick={sessions.create}>
          新建任务
        </NavigationAction>
        <NavigationAction icon={BoxIcon}>百宝箱</NavigationAction>
        <NavigationAction icon={BookOpenIcon} iconClassName="size-[17px]">
          知识库
        </NavigationAction>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="mt-0.5 mb-0.5 flex h-8 items-center px-3 text-sm font-medium text-muted-foreground">
          工作空间
        </h2>
        <div className="space-y-0.5">
          {workspaces.map((workspace) => (
            <Workspace key={workspace.name} workspace={workspace} />
          ))}
          <Workspace workspace={defaultWorkspace} />
        </div>
      </div>
    </div>
  )
}
