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
  trackRenderedRange: (range: RenderedRange) => void
  scrollerRef: (element: HTMLElement | Window | null) => void
  releaseAnchor: () => void
  scrollToBottom: () => void
} {
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const scrollerElement = useRef<HTMLElement | null>(null)
  const anchor = useRef<ViewportAnchor | null>(null)
  const renderedRange = useRef<RenderedRange | null>(null)
  const captureFrame = useRef<number | null>(null)
  const restoreFrame = useRef<number | null>(null)
  const settleFrame = useRef<number | null>(null)
  const isScrolling = useRef(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetAnchor = useCallback(() => {
    anchor.current = null
    renderedRange.current = null
    if (captureFrame.current !== null) cancelAnimationFrame(captureFrame.current)
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current)
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current)
    captureFrame.current = null
    restoreFrame.current = null
    settleFrame.current = null
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

  const trackRenderedRange = useCallback((range: RenderedRange) => {
    renderedRange.current = range
  }, [])

  useEffect(() => {
    if (!scroller || typeof ResizeObserver === 'undefined') return

    // 用"150ms 无滚动事件"近似判断用户停止滚动。关键：用户正在滚动（尤其往下滚）时，
    // 若流式增长触发 anchor 恢复，会把正在往下滚的 scrollTop 往回拉，表现为"往下滚被
    // 往上顶、回不到底"。故滚动中跳过恢复；用户停止后再重新捕获锚定并恢复，既能保持
    // 阅读位置不被流式顶走，又不阻止用户往下滚。
    const handleScroll = (): void => {
      isScrolling.current = true
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(() => {
        isScrolling.current = false
        captureAnchor()
      }, 150)
    }
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    const observer = new ResizeObserver(() => {
      if (scroller.closest('.larify-workbench-split[data-resizing]')) return
      if (isScrolling.current) return
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
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
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
    if (!element) return
    element.scrollTop = element.scrollHeight
    let frames = 0
    let lastHeight = -1
    const settle = (): void => {
      settleFrame.current = null
      if (scrollerElement.current !== element) return
      element.scrollTop = element.scrollHeight
      const height = element.scrollHeight
      frames += 1
      if (frames >= 10 || height === lastHeight) return
      lastHeight = height
      settleFrame.current = requestAnimationFrame(settle)
    }
    settleFrame.current = requestAnimationFrame(settle)
  }, [resetAnchor])

  return {
    captureAnchor,
    trackRenderedRange,
    scrollerRef,
    releaseAnchor: resetAnchor,
    scrollToBottom
  }
}
