import { useEffect, useRef, useState } from 'react'

/**
 * 折叠组件的开合状态（activity-group / activity-history 共用）：
 * - 初始 = initialOpen（父级已持久化的用户手势）或 defaultOpen（内容驱动的默认值）。
 * - 用户一旦手动开合（或 initialOpen 已有持久化值），就不再随 defaultOpen 自动变化，
 *   否则流式结束/新一轮开始时会强制覆盖用户手势（表现为"展开又被收起"）。
 */
export function useStickyOpen(
  initialOpen: boolean | undefined,
  defaultOpen: boolean
): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(initialOpen ?? defaultOpen)
  const wasDefaultOpen = useRef(defaultOpen)
  const userInteracted = useRef(initialOpen !== undefined)
  useEffect(() => {
    if (userInteracted.current) return
    if (wasDefaultOpen.current !== defaultOpen) setOpen(defaultOpen)
    wasDefaultOpen.current = defaultOpen
  }, [defaultOpen])
  return [
    open,
    (next: boolean) => {
      userInteracted.current = true
      setOpen(next)
    }
  ]
}
