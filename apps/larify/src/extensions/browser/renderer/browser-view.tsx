import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  nativeLayoutEvent,
  workbenchAnimationEvent,
  type WorkbenchAnimationState
} from '@renderer/app/layout/native-layout'
import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import { BROWSER_PARTITION } from '../shared/types'
import { BrowserToolbar } from './browser-toolbar'
import { EmptyState } from './empty-state'
import { LoadingBar } from './loading-bar'
import { useBrowser } from './use-browser'

/* eslint-disable react/no-unknown-property -- Electron webview attributes are not standard HTML. */

const parkedBounds = { left: -10_000, top: -10_000, width: 1280, height: 800 }

export function BrowserView({
  active,
  resourceId,
  sessionId
}: WorkbenchRendererProps): React.JSX.Element {
  const browser = useBrowser(sessionId, resourceId)
  const tab = browser.state
  const hasPage = Boolean(tab?.url && tab.url !== 'about:blank')
  // 工作台面板折叠时，webview（portal 到 body）不会被面板的 visibility 隐藏，
  // 只能靠 place() 移出屏幕。这里以工作台可见性为准，折叠时把 webview 定位到屏幕外。
  const [workbenchVisible, setWorkbenchVisible] = useState(true)
  useEffect(() => {
    const onWorkbenchAnimation = (event: Event): void => {
      const detail = (event as CustomEvent<WorkbenchAnimationState | undefined>).detail
      if (detail) setWorkbenchVisible(detail.visible)
    }
    window.addEventListener(workbenchAnimationEvent, onWorkbenchAnimation)
    return () => window.removeEventListener(workbenchAnimationEvent, onWorkbenchAnimation)
  }, [])
  const shown = Boolean(active) && hasPage && workbenchVisible
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const lastVisibleSizeRef = useRef({ width: parkedBounds.width, height: parkedBounds.height })

  useLayoutEffect(() => {
    const host = hostRef.current
    const viewport = viewportRef.current
    if (!host || !viewport) return
    const place = (): void => {
      if (host.dataset.browserRendering === 'true') {
        host.style.zIndex = shown ? '' : '-1'
        return
      }
      const viewportBounds = shown ? viewport.getBoundingClientRect() : null
      if (viewportBounds?.width && viewportBounds.height) {
        lastVisibleSizeRef.current = {
          width: viewportBounds.width,
          height: viewportBounds.height
        }
      }
      const bounds =
        viewportBounds?.width && viewportBounds.height
          ? viewportBounds
          : { ...parkedBounds, ...lastVisibleSizeRef.current }
      host.style.zIndex = ''
      Object.assign(host.style, {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`
      })
    }
    let revealFrame: number | null = null
    let settleFrame: number | null = null
    if (shown && host.dataset.browserRendering !== 'true') {
      host.style.visibility = 'hidden'
      place()
      revealFrame = requestAnimationFrame(() => {
        settleFrame = requestAnimationFrame(() => {
          place()
          host.style.visibility = ''
        })
      })
    } else {
      host.style.visibility = ''
      place()
    }
    const observer = new ResizeObserver(place)
    const leaseObserver = new MutationObserver(place)
    leaseObserver.observe(host, { attributeFilter: ['data-browser-rendering'] })
    if (shown) {
      observer.observe(viewport)
      window.addEventListener(nativeLayoutEvent, place)
    }
    window.addEventListener('resize', place)
    return () => {
      if (revealFrame !== null) cancelAnimationFrame(revealFrame)
      if (settleFrame !== null) cancelAnimationFrame(settleFrame)
      host.style.visibility = ''
      observer.disconnect()
      leaseObserver.disconnect()
      if (shown) window.removeEventListener(nativeLayoutEvent, place)
      window.removeEventListener('resize', place)
    }
  }, [shown])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    let active = true
    let attachedId = 0
    const attachingIds = new Set<number>()
    const guestId = (): number => {
      try {
        return webview.getWebContentsId()
      } catch {
        return 0
      }
    }
    const attach = (): void => {
      if (!active) return
      const webContentsId = guestId()
      if (!webContentsId || webContentsId === attachedId || attachingIds.has(webContentsId)) return
      attachingIds.add(webContentsId)
      void window.bridge
        .invoke('browser:attach', sessionId, resourceId, webContentsId)
        .then(() => {
          if (active && guestId() === webContentsId) attachedId = webContentsId
        })
        .catch(() => undefined)
        .finally(() => {
          attachingIds.delete(webContentsId)
        })
    }
    webview.addEventListener('did-attach', attach)
    webview.addEventListener('dom-ready', attach)
    attach()
    return () => {
      active = false
      webview.removeEventListener('did-attach', attach)
      webview.removeEventListener('dom-ready', attach)
    }
  }, [resourceId, sessionId])

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
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
        data-testid="browser-viewport"
      >
        {!hasPage ? <EmptyState /> : null}
      </div>
      {createPortal(
        <div
          ref={hostRef}
          className="fixed z-10 overflow-hidden"
          data-active={shown || undefined}
          data-browser-webview-host={resourceId}
        >
          {/* Native popups are denied after attachment; this lets Page.windowOpen route the
              request into a managed browser tab. */}
          <webview
            ref={webviewRef}
            // React drops true for non-boolean DOM attributes; Electron requires this attribute.
            allowpopups={'true' as unknown as boolean}
            className="size-full"
            partition={BROWSER_PARTITION}
            src="about:blank"
            webpreferences="backgroundThrottling=yes, contextIsolation=yes, nodeIntegration=no, sandbox=yes"
          />
        </div>,
        document.body
      )}
    </div>
  )
}
