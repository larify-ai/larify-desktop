'use client'

import { Button } from '@renderer/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@renderer/components/ui/button-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import type { UIMessage } from 'ai'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { ComponentProps, HTMLAttributes } from 'react'
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { Streamdown, type StreamdownTranslations } from 'streamdown'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role']
}

export const Message = ({ className, from, ...props }: MessageProps): React.JSX.Element => (
  <div
    className={cn(
      'group flex w-full flex-col gap-2',
      from === 'user' ? 'is-user ml-auto max-w-[95%] justify-end' : 'is-assistant max-w-full',
      className
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps): React.JSX.Element => (
  <div
    className={cn(
      'is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm group-[.is-assistant]:gap-4',
      'group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground',
      'group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground',
      className
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionsProps = ComponentProps<'div'>

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps): React.JSX.Element => (
  <div className={cn('flex items-center gap-1', className)} {...props}>
    {children}
  </div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps): React.JSX.Element => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

interface MessageBranchContextType {
  currentBranch: number
  totalBranches: number
  goToPrevious: () => void
  goToNext: () => void
  setTotalBranches: (count: number) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(null)

const useMessageBranch = (): MessageBranchContextType => {
  const context = useContext(MessageBranchContext)

  if (!context) {
    throw new Error('MessageBranch components must be used within MessageBranch')
  }

  return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number
  onBranchChange?: (branchIndex: number) => void
}

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps): React.JSX.Element => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch)
  const [totalBranches, setTotalBranches] = useState(0)
  const selectedBranch = totalBranches > 0 ? Math.min(currentBranch, totalBranches - 1) : 0

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch)
      onBranchChange?.(newBranch)
    },
    [onBranchChange]
  )

  const goToPrevious = useCallback(() => {
    const newBranch = selectedBranch > 0 ? selectedBranch - 1 : totalBranches - 1
    handleBranchChange(newBranch)
  }, [selectedBranch, totalBranches, handleBranchChange])

  const goToNext = useCallback(() => {
    const newBranch = selectedBranch < totalBranches - 1 ? selectedBranch + 1 : 0
    handleBranchChange(newBranch)
  }, [selectedBranch, totalBranches, handleBranchChange])

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      currentBranch: selectedBranch,
      goToNext,
      goToPrevious,
      setTotalBranches,
      totalBranches
    }),
    [goToNext, goToPrevious, selectedBranch, totalBranches]
  )

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div className={cn('grid w-full gap-2 [&>div]:pb-0', className)} {...props} />
    </MessageBranchContext.Provider>
  )
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps): React.JSX.Element[] => {
  const { currentBranch, setTotalBranches } = useMessageBranch()
  const childrenArray = useMemo(() => Children.toArray(children), [children])

  useEffect(() => {
    setTotalBranches(childrenArray.length)
  }, [childrenArray.length, setTotalBranches])

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        'grid gap-2 overflow-hidden [&>div]:pb-0',
        index === currentBranch ? 'block' : 'hidden'
      )}
      key={isValidElement(branch) && branch.key !== null ? branch.key : index}
      {...props}
    >
      {branch}
    </div>
  ))
}

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps): React.JSX.Element | null => {
  const { totalBranches } = useMessageBranch()

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null
  }

  return (
    <ButtonGroup
      className={cn(
        '[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md',
        className
      )}
      orientation="horizontal"
      {...props}
    />
  )
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps): React.JSX.Element => {
  const { goToPrevious, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="上一个分支"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  )
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps): React.JSX.Element => {
  const { goToNext, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="下一个分支"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  )
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps): React.JSX.Element => {
  const { currentBranch, totalBranches } = useMessageBranch()

  return (
    <ButtonGroupText
      className={cn('border-none bg-transparent text-muted-foreground shadow-none', className)}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  )
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const streamdownPlugins = { cjk, code, math, mermaid }
const streamdownControls = {
  table: { fullscreen: false },
  mermaid: { fullscreen: false }
}
const streamdownTranslations = {
  close: '关闭',
  copied: '已复制',
  copyCode: '复制代码',
  copyLink: '复制链接',
  copyTable: '复制表格',
  copyTableAsCsv: '复制为 CSV',
  copyTableAsMarkdown: '复制为 Markdown',
  copyTableAsTsv: '复制为 TSV',
  downloadDiagram: '下载图表',
  downloadDiagramAsMmd: '下载为 MMD',
  downloadDiagramAsPng: '下载为 PNG',
  downloadDiagramAsSvg: '下载为 SVG',
  downloadFile: '下载文件',
  downloadImage: '下载图片',
  downloadTable: '下载表格',
  downloadTableAsCsv: '下载为 CSV',
  downloadTableAsMarkdown: '下载为 Markdown',
  exitFullscreen: '退出全屏',
  externalLinkWarning: '即将打开外部链接',
  imageNotAvailable: '图片不可用',
  mermaidFormatMmd: 'MMD',
  mermaidFormatPng: 'PNG',
  mermaidFormatSvg: 'SVG',
  openExternalLink: '打开外部链接',
  openLink: '打开链接',
  resetView: '重置视图',
  tableFormatCsv: 'CSV',
  tableFormatMarkdown: 'Markdown',
  tableFormatTsv: 'TSV',
  viewFullscreen: '全屏查看',
  zoomIn: '放大',
  zoomOut: '缩小'
} satisfies StreamdownTranslations

let codeHighlighterPreloadScheduled = false

function useCodeHighlighterPreload(): void {
  useEffect(() => {
    if (codeHighlighterPreloadScheduled) return
    codeHighlighterPreloadScheduled = true
    const preload = (): void => {
      code.highlight({ code: '', language: 'typescript', themes: code.getThemes() })
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(preload, { timeout: 2_000 })
      return
    }
    window.setTimeout(preload, 0)
  }, [])
}

function MessageResponseView({ className, ...props }: MessageResponseProps): React.JSX.Element {
  useCodeHighlighterPreload()
  return (
    <Streamdown
      className={cn(
        'larify-message-markdown size-full space-y-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className
      )}
      controls={streamdownControls}
      plugins={streamdownPlugins}
      translations={streamdownTranslations}
      {...props}
    />
  )
}

export const MessageResponse = memo(MessageResponseView)

MessageResponse.displayName = 'MessageResponse'

export type MessageToolbarProps = ComponentProps<'div'>

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps): React.JSX.Element => (
  <div className={cn('mt-4 flex w-full items-center justify-between gap-4', className)} {...props}>
    {children}
  </div>
)
