import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { MessageCirclePlusIcon } from 'lucide-react'
import { ThemeProvider } from 'next-themes'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import type { App } from 'kernel'
import type { View } from '@renderer/types/view'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarInset
} from '@renderer/components/ui/sidebar'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@renderer/components/ui/resizable'
import { useNativeThemeSync } from '../hooks/use-native-theme-sync'

const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties

const NEW_TASK_LABEL = '新建'

const DEFAULT_WORKBENCH_SIZE = 72
const MIN_WORKBENCH_SIZE = 20
const MIN_ASSISTANT_SIZE = 20

const sidebarItemClass =
  'grid size-10 place-items-center gap-0 p-0 text-center [&>svg]:size-6! [&>svg]:shrink-0'
const sidebarMenuClass = 'w-full items-center gap-0 px-1'
const TOOLTIP_DELAY = 300

type SidebarView = View & { sidebar: NonNullable<View['sidebar']> }

function isSidebarView(view: View): view is SidebarView {
  return view.sidebar != null
}

function useNativeTooltip(): {
  hideTooltip: () => void
  showTooltip: (element: HTMLElement, label: string) => void
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const hideTooltip = useCallback((): void => {
    clearTimeout(timerRef.current)
    timerRef.current = undefined
    void window.bridge.invoke('tooltip:hide').catch(() => {})
  }, [])

  const showTooltip = useCallback((element: HTMLElement, label: string): void => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!element.matches(':hover')) return
      const rect = element.getBoundingClientRect()
      const rootStyles = getComputedStyle(document.documentElement)
      void window.bridge
        .invoke('tooltip:show', {
          background: rootStyles.getPropertyValue('--foreground').trim(),
          fontFamily: getComputedStyle(document.body).fontFamily,
          foreground: rootStyles.getPropertyValue('--background').trim(),
          label,
          radius: rootStyles.getPropertyValue('--radius').trim(),
          x: window.screenX + rect.right - 10,
          y: window.screenY + rect.top + rect.height / 2
        })
        .catch(() => {})
    }, TOOLTIP_DELAY)
  }, [])

  useEffect(() => hideTooltip, [hideTooltip])
  return { hideTooltip, showTooltip }
}

export function Shell({ app }: { app: App }): React.JSX.Element {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ShellBody app={app} />
    </ThemeProvider>
  )
}

function ShellBody({ app }: { app: App }): React.JSX.Element {
  const [workbench, setWorkbench] = useState<string | null>(null)
  const [mountedWorkbenches, setMountedWorkbenches] = useState<string[]>([])
  const workbenchPanelRef = useRef<ImperativePanelHandle>(null)
  const { hideTooltip, showTooltip } = useNativeTooltip()
  useNativeThemeSync()

  const sidebarViews = app
    .getAll<View>('view')
    .filter(isSidebarView)
    .sort((a, b) => (a.sidebar.order ?? 0) - (b.sidebar.order ?? 0))
  const headerViews = sidebarViews.filter((view) => view.sidebar.placement === 'header')
  const contentViews = sidebarViews.filter(
    (view) => !view.sidebar.placement || view.sidebar.placement === 'content'
  )
  const footerViews = sidebarViews.filter((view) => view.sidebar.placement === 'footer')

  const toggleWorkbench = (id: string): void => {
    setWorkbench((current) => (current === id ? null : id))
    setMountedWorkbenches((current) => (current.includes(id) ? current : [...current, id]))
  }

  const renderSidebarButton = (view: SidebarView): React.JSX.Element => (
    <ViewSidebarButton
      key={view.sidebar.id}
      view={view}
      active={workbench === view.sidebar.id}
      onClick={() => toggleWorkbench(view.sidebar.id)}
      hideTooltip={hideTooltip}
      showTooltip={showTooltip}
    />
  )

  useLayoutEffect(() => {
    const panel = workbenchPanelRef.current
    if (!panel) return
    if (workbench) panel.expand()
    else panel.collapse()
  }, [workbench])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('larify:workbench-active', { detail: workbench }))
  }, [workbench])

  useEffect(() => {
    const sendActiveWorkbench = (): void => {
      window.dispatchEvent(new CustomEvent('larify:workbench-active', { detail: workbench }))
    }
    window.addEventListener('larify:workbench-active-request', sendActiveWorkbench)
    return () => window.removeEventListener('larify:workbench-active-request', sendActiveWorkbench)
  }, [workbench])

  useEffect(() => {
    const closeWorkbench = (event: Event): void => {
      const id = (event as CustomEvent<string | null | undefined>).detail
      setWorkbench((current) => (id && current !== id ? current : null))
    }
    window.addEventListener('larify:workbench-close', closeWorkbench)
    return () => window.removeEventListener('larify:workbench-close', closeWorkbench)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground">
      <div
        className="relative flex h-(--titlebar-h) shrink-0 items-center bg-sidebar"
        style={dragRegion}
      />
      <SidebarProvider
        className="min-h-0 flex-1 bg-sidebar"
        style={{ '--sidebar-width': '3rem' } as CSSProperties}
      >
        <Sidebar collapsible="none" className="border-0">
          <SidebarContent className="items-center gap-0 overflow-x-hidden overflow-y-auto">
            <SidebarMenu className={sidebarMenuClass}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label={NEW_TASK_LABEL}
                  onClick={() => {
                    hideTooltip()
                    window.dispatchEvent(new Event('agent:new-session'))
                  }}
                  onMouseEnter={(event) => showTooltip(event.currentTarget, NEW_TASK_LABEL)}
                  onMouseLeave={hideTooltip}
                  className={sidebarItemClass}
                >
                  <MessageCirclePlusIcon />
                </SidebarMenuButton>
              </SidebarMenuItem>
              {headerViews.map(renderSidebarButton)}
            </SidebarMenu>
            <SidebarMenu className={sidebarMenuClass}>
              {contentViews.map(renderSidebarButton)}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="items-center px-0">
            <SidebarMenu className={sidebarMenuClass}>
              {footerViews.map(renderSidebarButton)}
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="overflow-hidden rounded-tl-[10px] bg-background">
          <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1">
            <ResizablePanel
              ref={workbenchPanelRef}
              id="workbench"
              order={1}
              defaultSize={DEFAULT_WORKBENCH_SIZE}
              minSize={MIN_WORKBENCH_SIZE}
              collapsible
              collapsedSize={0}
              onCollapse={() => setWorkbench(null)}
            >
              <div className="relative h-full w-full overflow-hidden">
                {sidebarViews
                  .filter((view) => mountedWorkbenches.includes(view.sidebar.id))
                  .map((view) => {
                    const id = view.sidebar.id
                    return (
                      <div key={id} className={workbench === id ? 'absolute inset-0' : 'hidden'}>
                        {view.render()}
                      </div>
                    )
                  })}
              </div>
            </ResizablePanel>
            <ResizableHandle className={workbench ? undefined : 'pointer-events-none opacity-0'} />
            <ResizablePanel id="assistant" order={2} minSize={MIN_ASSISTANT_SIZE}>
              <div className="h-full bg-background">
                {app.get<View>('view', 'assistant')?.render()}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

function ViewSidebarButton({
  active,
  hideTooltip,
  onClick,
  showTooltip,
  view
}: {
  active: boolean
  hideTooltip: () => void
  onClick: () => void
  showTooltip: (element: HTMLElement, label: string) => void
  view: SidebarView
}): React.JSX.Element {
  const Icon = view.sidebar.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-label={view.sidebar.label}
        isActive={active}
        onClick={() => {
          hideTooltip()
          onClick()
        }}
        onMouseEnter={(event) => showTooltip(event.currentTarget, view.sidebar.label)}
        onMouseLeave={hideTooltip}
        className={sidebarItemClass}
      >
        <Icon />
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
