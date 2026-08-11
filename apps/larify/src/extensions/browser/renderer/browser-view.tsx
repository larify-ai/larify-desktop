import { useEffect, useState } from 'react'
import { WorkbenchTabsLayout, type WorkbenchTab } from '@renderer/components/workbench'
import { GlobeIcon } from 'lucide-react'
import { BrowserToolbar } from './browser-toolbar'
import { BrowserViewport } from './browser-viewport'
import { EmptyState } from './empty-state'
import { LoadingBar } from './loading-bar'
import { useBrowser } from './use-browser'
import { useAssistantSessions } from '@renderer/app/interaction/assistant/sessions-context'

function BrowserTabIcon({ favicon }: { favicon: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!favicon || failed) return <GlobeIcon aria-hidden className="size-4" />
  return (
    <img
      alt=""
      className="size-4"
      draggable={false}
      src={favicon}
      onError={() => setFailed(true)}
    />
  )
}

export function BrowserView(): React.JSX.Element {
  const sessionId = useAssistantSessions().activeId
  const browser = useBrowser(sessionId)
  const { active, state } = browser
  const create = browser.create
  useEffect(() => {
    const open = (event: Event): void => {
      const url = (event as CustomEvent<string>).detail
      if (!url) return
      void create(url)
        .then(() => {
          window.dispatchEvent(new CustomEvent('larify:workbench-open', { detail: 'browser' }))
        })
        .catch((error) => console.error('[browser:open-url]', error))
    }
    window.addEventListener('larify:browser-open-url', open)
    return () => window.removeEventListener('larify:browser-open-url', open)
  }, [create])
  const tabs = state.tabs.map<WorkbenchTab>((tab) => ({
    active: tab.id === state.activeId,
    icon: <BrowserTabIcon key={tab.favIconUrl || 'fallback'} favicon={tab.favIconUrl} />,
    id: String(tab.id),
    title: tab.title || tab.url || '新标签页'
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
            onNavigate={(url) =>
              active ? browser.navigate(active.id, url) : Promise.resolve(false)
            }
            onReload={() => active && void browser.reload(active.id)}
          />
          <LoadingBar loading={active?.loading ?? false} />
        </div>
        <BrowserViewport sessionId={sessionId} visible={Boolean(active?.url)}>
          {!active?.url ? <EmptyState /> : null}
        </BrowserViewport>
      </div>
    </WorkbenchTabsLayout>
  )
}
