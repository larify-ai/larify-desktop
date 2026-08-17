import { BookOpenIcon, BoxIcon, MessageCirclePlusIcon } from 'lucide-react'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'
import { NavigationAction } from './navigation-action'
import { Workspace } from './workspace'
import { createWorkspaces } from './workspaces'

export function NavigationContent(): React.JSX.Element {
  const sessions = useAssistantSessions()
  const workspaces = createWorkspaces(sessions)

  return (
    <div className="flex h-full min-h-0 flex-col pb-2">
      <nav aria-label="全局入口" className="space-y-0.5">
        <NavigationAction icon={MessageCirclePlusIcon} onClick={() => sessions.create()}>
          新建任务
        </NavigationAction>
        <NavigationAction icon={BoxIcon}>百宝箱</NavigationAction>
        <NavigationAction icon={BookOpenIcon} iconClassName="size-[17px]">
          知识库
        </NavigationAction>
      </nav>

      <h2
        id="workspaces-heading"
        className="mt-0.5 mb-0.5 flex h-8 shrink-0 items-center px-3 text-sm font-medium text-muted-foreground"
      >
        工作空间
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

      <div aria-hidden="true" className="h-14 shrink-0" />
    </div>
  )
}
