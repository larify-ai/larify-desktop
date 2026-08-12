import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface ViewportAnchor {
  index: number
  bottomOffset: number
}

interface RenderedRange {
  startIndex: number
  endIndex: number
}

interface AnchorElement {
  index: number
  bottom: number
}

function findBottomAnchor(
  scroller: HTMLElement,
  viewport: DOMRect,
  { startIndex, endIndex }: RenderedRange
): AnchorElement | null {
  let low = startIndex
  let high = endIndex
  let fullyVisible: AnchorElement | null = null
  let intersecting: AnchorElement | null = null

  while (low <= high) {
    const index = Math.floor((low + high) / 2)
    const element = scroller.querySelector<HTMLElement>(`[data-message-index="${index}"]`)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const candidate = { index, bottom: rect.bottom }
    if (rect.bottom <= viewport.top) {
      low = index + 1
    } else if (rect.bottom <= viewport.bottom) {
      fullyVisible = candidate
      low = index + 1
    } else {
      if (rect.top < viewport.bottom) intersecting = candidate
      high = index - 1
    }
  }

  return fullyVisible ?? intersecting
}

export function useViewportBottomAnchor(resetKey?: unknown): {
  captureAnchor: (range?: RenderedRange) => void
  scrollerRef: (element: HTMLElement | Window | null) => void
  scrollToBottom: () => void
} {
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const scrollerElement = useRef<HTMLElement | null>(null)
  const anchor = useRef<ViewportAnchor | null>(null)
  const renderedRange = useRef<RenderedRange | null>(null)
  const captureFrame = useRef<number | null>(null)
  const restoreFrame = useRef<number | null>(null)

  const resetAnchor = useCallback(() => {
    anchor.current = null
    renderedRange.current = null
    if (captureFrame.current !== null) cancelAnimationFrame(captureFrame.current)
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current)
    captureFrame.current = null
    restoreFrame.current = null
  }, [])

  useLayoutEffect(resetAnchor, [resetAnchor, resetKey])

  const captureAnchor = useCallback(
    (range?: RenderedRange) => {
      if (range) renderedRange.current = range
      if (!scroller || restoreFrame.current !== null) return
      const savedIndex = anchor.current?.index
      const candidateRange = range ?? renderedRange.current
      if (!candidateRange && savedIndex === undefined) return
      if (captureFrame.current !== null) cancelAnimationFrame(captureFrame.current)
      captureFrame.current = requestAnimationFrame(() => {
        captureFrame.current = null
        const viewport = scroller.getBoundingClientRect()
        if (viewport.width === 0 || viewport.height === 0) return
        const anchorElement = findBottomAnchor(scroller, viewport, {
          startIndex: candidateRange?.startIndex ?? Number(savedIndex),
          endIndex: candidateRange?.endIndex ?? Number(savedIndex)
        })
        if (!anchorElement) return
        anchor.current = {
          index: anchorElement.index,
          bottomOffset: viewport.bottom - anchorElement.bottom
        }
      })
    },
    [scroller]
  )

  useEffect(() => {
    if (!scroller || typeof ResizeObserver === 'undefined') return

    const handleScroll = (): void => captureAnchor()
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    const observer = new ResizeObserver(() => {
      const viewport = scroller.getBoundingClientRect()
      if (viewport.width === 0 || viewport.height === 0) return
      const saved = anchor.current
      if (!saved) {
        return
      }
      if (captureFrame.current !== null) cancelAnimationFrame(captureFrame.current)
      captureFrame.current = null
      if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current)
      restoreFrame.current = requestAnimationFrame(() => {
        restoreFrame.current = null
        const item = scroller.querySelector<HTMLElement>(`[data-message-index="${saved.index}"]`)
        if (!item) {
          captureAnchor()
          return
        }
        const viewport = scroller.getBoundingClientRect()
        if (viewport.width === 0 || viewport.height === 0) return
        const currentOffset = viewport.bottom - item.getBoundingClientRect().bottom
        scroller.scrollTop += saved.bottomOffset - currentOffset
      })
    })
    observer.observe(scroller)
    captureAnchor()

    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', handleScroll)
      if (captureFrame.current !== null) cancelAnimationFrame(captureFrame.current)
      if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current)
      captureFrame.current = null
      restoreFrame.current = null
    }
  }, [captureAnchor, scroller])

  const scrollerRef = useCallback((element: HTMLElement | Window | null) => {
    const next = element instanceof HTMLElement ? element : null
    scrollerElement.current = next
    setScroller(next)
  }, [])

  const scrollToBottom = useCallback(() => {
    resetAnchor()
    const element = scrollerElement.current
    if (element) element.scrollTop = element.scrollHeight
  }, [resetAnchor])

  return { captureAnchor, scrollerRef, scrollToBottom }
}
