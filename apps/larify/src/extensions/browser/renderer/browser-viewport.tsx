import { useEffect, useRef, useState, type ReactNode } from "react"
import { getAgentSessionId, useAgentSessionId } from "@renderer/lib/agent-session"

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void window.bridge.invoke("browser:setVisible", getAgentSessionId(), false)
  })
}

interface BrowserViewportProps {
  children?: ReactNode
  visible: boolean
}

export function BrowserViewport({ children, visible }: BrowserViewportProps): React.JSX.Element {
  const sessionId = useAgentSessionId()
  const ref = useRef<HTMLDivElement>(null)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const [workbenchKnown, setWorkbenchKnown] = useState(false)
  const [viewportHasSize, setViewportHasSize] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let frame: number | null = null
    void window.bridge.invoke("browser:setVisible", sessionId, false)

    const reportNow = (): void => {
      frame = null
      const rect = element.getBoundingClientRect()
      setViewportHasSize(rect.width > 0 && rect.height > 0)
      void window.bridge.invoke("browser:setBounds", sessionId, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    const report = (): void => {
      if (frame === null) frame = requestAnimationFrame(reportNow)
    }

    reportNow()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener("resize", report)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", report)
      void window.bridge.invoke("browser:setVisible", sessionId, false)
    }
  }, [sessionId])

  useEffect(() => {
    const onActive = (event: Event): void => {
      setWorkbenchKnown(true)
      setWorkbenchVisible((event as CustomEvent<string | null>).detail === "browser")
    }
    window.addEventListener("larify:workbench-active", onActive)
    window.dispatchEvent(new Event("larify:workbench-active-request"))
    return () => {
      window.removeEventListener("larify:workbench-active", onActive)
      void window.bridge.invoke("browser:setVisible", sessionId, false)
    }
  }, [sessionId])

  useEffect(() => {
    void window.bridge.invoke(
      "browser:setVisible",
      sessionId,
      visible && workbenchKnown && workbenchVisible && viewportHasSize,
    )
  }, [sessionId, visible, viewportHasSize, workbenchKnown, workbenchVisible])

  return (
    <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-(--workbench-content)">
      {children}
    </div>
  )
}
