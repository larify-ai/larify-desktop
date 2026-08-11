import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import { BrowserToolbar } from './browser-toolbar'
import { BrowserViewport } from './browser-viewport'
import { EmptyState } from './empty-state'
import { LoadingBar } from './loading-bar'
import { useBrowser } from './use-browser'

export function BrowserView({ resourceId, sessionId }: WorkbenchRendererProps): React.JSX.Element {
  const browser = useBrowser(sessionId, resourceId)
  const tab = browser.state
  const hasPage = Boolean(tab?.url && tab.url !== 'about:blank')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0">
        <BrowserToolbar
          tab={tab}
          onBack={() => void browser.back().catch(() => undefined)}
          onForward={() => void browser.forward().catch(() => undefined)}
          onNavigate={browser.navigate}
          onReload={() => void browser.reload().catch(() => undefined)}
        />
        <LoadingBar loading={tab?.loading ?? false} />
      </div>
      <BrowserViewport resourceId={resourceId} sessionId={sessionId} visible={hasPage}>
        {!hasPage ? <EmptyState /> : null}
      </BrowserViewport>
    </div>
  )
}
