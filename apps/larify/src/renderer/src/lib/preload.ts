export function preloadAfterPageLoad(callback: () => void, timeout = 2_000): () => void {
  let idle: number | undefined

  const preload = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(callback, { timeout })
    } else {
      idle = window.setTimeout(callback)
    }
  }

  if (document.readyState === 'complete') preload()
  else window.addEventListener('load', preload, { once: true })

  return () => {
    window.removeEventListener('load', preload)
    if (idle === undefined) return
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle)
    else window.clearTimeout(idle)
  }
}
