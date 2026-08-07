import { useEffect, useRef, useState, type RefObject } from 'react'
import { FolderIcon, PlusIcon } from 'lucide-react'
import {
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  usePromptInputAttachments
} from '@renderer/components/ai-elements/prompt-input'

interface ComposerMenuProps {
  inputRef: RefObject<HTMLDivElement | null>
}

interface MenuMetrics {
  alignOffset: number
  sideOffset: number
  width: number
}

function useMenuMetrics(
  inputRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLDivElement | null>
): MenuMetrics {
  const [metrics, setMetrics] = useState<MenuMetrics>({ alignOffset: 0, sideOffset: 0, width: 0 })

  useEffect(() => {
    const measure = (): void => {
      const input = inputRef.current?.getBoundingClientRect()
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!input || !trigger) return
      const next = {
        alignOffset: input.left - trigger.left,
        sideOffset: trigger.top - input.top,
        width: input.width
      }
      setMetrics((current) =>
        current.alignOffset === next.alignOffset &&
        current.sideOffset === next.sideOffset &&
        current.width === next.width
          ? current
          : next
      )
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (inputRef.current) observer.observe(inputRef.current)
    return () => observer.disconnect()
  }, [inputRef, triggerRef])

  return metrics
}

function DirectoryAttachment(): React.JSX.Element {
  const attachments = usePromptInputAttachments()

  const select = async (): Promise<void> => {
    const paths = await window.bridge.invoke('dialog:pick-directories')
    if (!Array.isArray(paths)) return
    attachments.addParts(
      paths
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
        .map((path) => ({
          id: crypto.randomUUID(),
          type: 'file',
          filename: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
          mediaType: 'inode/directory',
          url: path
        }))
    )
  }

  return (
    <PromptInputActionMenuItem className="gap-2" onSelect={() => void select()}>
      <FolderIcon className="size-4" />
      目录
    </PromptInputActionMenuItem>
  )
}

export function ComposerMenu({ inputRef }: ComposerMenuProps): React.JSX.Element {
  const triggerRef = useRef<HTMLDivElement>(null)
  const metrics = useMenuMetrics(inputRef, triggerRef)

  return (
    <PromptInputActionMenu>
      <div ref={triggerRef}>
        <PromptInputActionMenuTrigger
          size="icon-sm"
          style={{ borderRadius: 9999 }}
          className="border border-transparent bg-secondary text-secondary-foreground hover:border-border hover:bg-muted hover:text-foreground data-[state=open]:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground focus-visible:border-transparent focus-visible:ring-0"
        >
          <PlusIcon className="size-4" />
        </PromptInputActionMenuTrigger>
      </div>
      <PromptInputActionMenuContent
        side="top"
        align="start"
        sideOffset={metrics.sideOffset + 4}
        alignOffset={metrics.alignOffset}
        className="rounded-2xl shadow-none"
        style={{ width: metrics.width }}
      >
        <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">添加附件</div>
        <PromptInputActionAddAttachments label="文件" />
        <DirectoryAttachment />
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  )
}
