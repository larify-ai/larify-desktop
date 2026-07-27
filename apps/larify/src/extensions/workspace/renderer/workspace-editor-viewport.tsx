import { useEffect, useRef } from 'react'
import { workspaceEditorClient } from './workspace-editor-client'

export function WorkspaceEditorViewport({ visible }: { visible: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    const report = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        void workspaceEditorClient.setBounds({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        })
      })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', report)
      void workspaceEditorClient.setVisible(false)
    }
  }, [])

  useEffect(() => {
    void workspaceEditorClient.setVisible(visible)
  }, [visible])

  return <div ref={ref} className="h-full min-h-0 w-full" />
}
