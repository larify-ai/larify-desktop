import { useRef, useState } from 'react'
import { FileDiffIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { basename } from '@codingame/monaco-vscode-api/vscode/vs/base/common/path'
import { Button } from '@renderer/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@renderer/components/ui/resizable'
import { openWorkspaceFile } from './monaco'
import { WorkspaceEditor } from './workspace-editor'
import { WorkspaceTree } from './workspace-tree'
import { useWorkspaceExplorer } from './use-workspace-explorer'

function ViewToggle({
  changesOnly,
  onClick
}: {
  changesOnly: boolean
  onClick(): void
}): React.JSX.Element {
  const label = changesOnly ? '全局视图' : '变更视图'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={changesOnly}
          className="[&_svg]:size-4!"
          size="icon-xs"
          variant={changesOnly ? 'secondary' : 'ghost'}
          onClick={onClick}
        >
          <FileDiffIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function WorkspaceView(): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const explorerRef = useRef<ImperativePanelHandle>(null)
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  const [changesOnly, setChangesOnly] = useState(false)
  const { entries, loadDirectory, openFolder, root } = useWorkspaceExplorer()

  return (
    <ResizablePanelGroup direction="horizontal" className="bg-background">
      <ResizablePanel
        ref={explorerRef}
        collapsible
        collapsedSize={0}
        defaultSize={26}
        minSize={16}
        maxSize={40}
        onCollapse={() => setExplorerCollapsed(true)}
        onExpand={() => setExplorerCollapsed(false)}
      >
        <div className="flex h-full min-h-0 flex-col">
          {root && !changesOnly ? (
            <WorkspaceTree
              entries={[
                {
                  children: entries,
                  kind: 'directory',
                  loaded: true,
                  name: basename(root),
                  path: root,
                  root: true
                }
              ]}
              onOpen={(file) => void openWorkspaceFile(file)}
              onToggle={(entry) => void loadDirectory(entry)}
              rootAction={
                <ViewToggle changesOnly={false} onClick={() => setChangesOnly(true)} />
              }
            />
          ) : root ? (
            <div className="relative flex min-h-0 flex-1">
              <WorkspaceTree
                entries={[
                  {
                    children: [],
                    kind: 'directory',
                    loaded: true,
                    name: basename(root),
                    path: root,
                    root: true
                  }
                ]}
                onOpen={(file) => void openWorkspaceFile(file)}
                onToggle={(entry) => void loadDirectory(entry)}
                rootAction={
                  <ViewToggle changesOnly onClick={() => setChangesOnly(false)} />
                }
              />
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 pt-12 text-center text-sm text-muted-foreground">
                变更视图将在接入 Git 后显示
              </div>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <Button onClick={() => void openFolder()}>打开文件夹</Button>
            </div>
          )}
        </div>
      </ResizablePanel>
      <ResizableHandle
        aria-label="调整文件树宽度"
        className={explorerCollapsed ? 'bg-transparent' : undefined}
        onDoubleClick={() =>
          explorerCollapsed ? explorerRef.current?.expand() : explorerRef.current?.collapse()
        }
      />
      <ResizablePanel minSize={40}>
        <WorkspaceEditor theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
