import { lazy, Suspense } from 'react'
import { GlobeIcon } from 'lucide-react'
import type { Extension } from '@shared/extension'
import type { View } from '@renderer/types/view'

let browserViewPromise: Promise<{ default: typeof import('./browser-view').BrowserView }> | null =
  null

const loadBrowserView = (): NonNullable<typeof browserViewPromise> => {
  browserViewPromise ??= import('./browser-view')
    .then(({ BrowserView }) => ({ default: BrowserView }))
    .catch((error) => {
      browserViewPromise = null
      throw error
    })
  return browserViewPromise
}

const BrowserView = lazy(loadBrowserView)

const extension: Extension = {
  activate(app, context) {
    app.register('view', 'browser', {
      sidebar: { icon: GlobeIcon, id: 'browser', label: '浏览', order: 8, placement: 'content' },
      render: () => (
        <Suspense fallback={null}>
          <BrowserView />
        </Suspense>
      )
    } satisfies View)
    const unsubscribe = window.bridge.on('browser:open-url', (value) => {
      if (typeof value !== 'string') return
      window.dispatchEvent(new CustomEvent('larify:browser-open-url', { detail: value }))
    })
    context.subscriptions.push({
      dispose: () => {
        unsubscribe()
      }
    })
  }
}

export default extension
