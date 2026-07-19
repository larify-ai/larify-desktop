import { WorkbenchTabsLayout, type WorkbenchTab } from "@renderer/components/workbench"
import { BrowserToolbar } from "./browser-toolbar"
import { BrowserViewport } from "./browser-viewport"
import { EmptyState } from "./empty-state"
import { LoadingBar } from "./loading-bar"
import { useBrowser } from "./use-browser"

const DEFAULT_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  )

const tabIcon = (favicon: string): React.ReactNode => {
  return (
    <img
      alt=""
      className="size-4"
      draggable={false}
      src={favicon || DEFAULT_FAVICON}
      onError={(event) => {
        if (event.currentTarget.src === DEFAULT_FAVICON) return
        event.currentTarget.src = DEFAULT_FAVICON
      }}
    />
  )
}

export function BrowserView(): React.JSX.Element {
  const browser = useBrowser()
  const { active, state } = browser
  const tabs = state.tabs.map<WorkbenchTab>((tab) => ({
    active: tab.id === state.activeId,
    icon: tabIcon(tab.favIconUrl),
    id: String(tab.id),
    title: tab.title || tab.url || "新标签页",
  }))

  return (
    <WorkbenchTabsLayout
      draggable
      newLabel="新建"
      tabs={tabs}
      onClose={(id) => void browser.close(Number(id))}
      onCreate={() => void browser.create()}
      onReorder={(id, _from, to) => void browser.reorder(Number(id), to)}
      onSelect={(id) => void browser.setActive(Number(id))}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative shrink-0">
          <BrowserToolbar
            tab={active}
            onBack={() => active && void browser.back(active.id)}
            onForward={() => active && void browser.forward(active.id)}
            onNavigate={(url) => (active ? browser.navigate(active.id, url) : Promise.resolve(false))}
            onReload={() => active && void browser.reload(active.id)}
          />
          <LoadingBar loading={active?.loading ?? false} />
        </div>
        <BrowserViewport visible={Boolean(active?.url)}>{!active?.url ? <EmptyState /> : null}</BrowserViewport>
      </div>
    </WorkbenchTabsLayout>
  )
}
