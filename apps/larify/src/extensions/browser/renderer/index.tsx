import { lazy, Suspense, type ReactNode } from 'react'
import { GlobeIcon } from 'lucide-react'
import type { RendererPlugin } from '@renderer/app/registry/renderer-plugins'
import {
  type WorkbenchTabPresentation,
  type WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '@renderer/app/registry/workbench-renderers'
import type { BrowserState, BrowserTabState } from '../shared/types'
import { BrowserTabIcon } from './browser-tab-icon'

const BrowserView = lazy(() =>
  import('./browser-view').then(({ BrowserView }) => ({ default: BrowserView }))
)

const tabIcon = (tab: BrowserTabState): ReactNode => (
  <BrowserTabIcon key={tab.favIconUrl || 'fallback'} favicon={tab.favIconUrl} />
)

const tabTitle = (tab: BrowserTabState): string =>
  tab.title || (tab.url && tab.url !== 'about:blank' ? tab.url : '新标签页')

const plugin: RendererPlugin = {
  id: 'browser',
  activate({ registry, subscriptions }) {
    const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
    if (!renderers) throw new Error('Workbench renderer registry is unavailable.')
    subscriptions.push(
      renderers.register('browser', {
        bindTab: ({ resourceId, sessionId, updateTab }) => {
          updateTab({
            icon: <GlobeIcon aria-hidden className="larify-workbench-icon-browser" />,
            title: '新标签页'
          })
          let currentTitle = '新标签页'
          let currentFavicon = ''
          const apply = (tab: BrowserTabState | null | undefined): void => {
            if (!tab) return
            const title = tabTitle(tab)
            const favicon = tab.favIconUrl || ''
            if (title === currentTitle && favicon === currentFavicon) return
            const presentation: Partial<WorkbenchTabPresentation> = {}
            if (title !== currentTitle) presentation.title = title
            if (favicon !== currentFavicon) presentation.icon = tabIcon(tab)
            currentTitle = title
            currentFavicon = favicon
            updateTab(presentation)
          }
          let active = true
          let receivedEvent = false
          const unsubscribe = window.bridge.on('browser:state', (value) => {
            const event = value as { sessionId?: string; state?: BrowserState }
            if (event.sessionId !== sessionId || !event.state) return
            const tab = event.state.tabs.find(({ id }) => id === resourceId)
            if (!tab) return
            receivedEvent = true
            apply(tab)
          })
          void window.bridge
            .invoke('browser:getState', sessionId, resourceId)
            .then((value) => {
              if (active && !receivedEvent) apply(value as BrowserTabState | null)
            })
            .catch(() => undefined)
          return {
            dispose: () => {
              active = false
              unsubscribe()
            }
          }
        },
        component: (props) => (
          <Suspense fallback={null}>
            <BrowserView {...props} />
          </Suspense>
        ),
        icon: <GlobeIcon aria-hidden className="larify-workbench-icon-browser" />,
        order: 40,
        title: '浏览器'
      })
    )
  }
}

export default plugin
