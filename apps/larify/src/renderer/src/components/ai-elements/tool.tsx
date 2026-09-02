'use client'

import { Badge } from '@renderer/components/ui/badge'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { cn } from '@renderer/lib/utils'
import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  MessageSquareTextIcon,
  type LucideIcon,
  SearchIcon,
  SquareTerminalIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon
} from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, isValidElement, useContext } from 'react'

import { CodeBlock } from './code-block'

export type ToolProps = ComponentProps<typeof Collapsible>

const ToolOpenContext = createContext(false)

export const Tool = ({
  className,
  defaultOpen,
  open,
  onOpenChange,
  ...props
}: ToolProps): React.JSX.Element => {
  const [currentOpen = false, setCurrentOpen] = useControllableState({
    prop: open,
    defaultProp: Boolean(defaultOpen),
    onChange: onOpenChange
  })

  return (
    <ToolOpenContext.Provider value={currentOpen}>
      <Collapsible
        className={cn('group not-prose w-full rounded-md border', className)}
        open={currentOpen}
        onOpenChange={setCurrentOpen}
        {...props}
      />
    </ToolOpenContext.Provider>
  )
}

export type ToolPart = ToolUIPart | DynamicToolUIPart

const kindIcons: Record<string, LucideIcon> = {
  search: SearchIcon,
  execute: TerminalIcon,
  terminal: SquareTerminalIcon,
  browser: GlobeIcon,
  'message-square-text': MessageSquareTextIcon,
  read: FileTextIcon,
  edit: SquarePenIcon,
  image: ImageIcon,
  other: WrenchIcon
}

export const ToolIcon = ({
  kind,
  ...props
}: Omit<ComponentProps<LucideIcon>, 'ref'> & {
  kind?: string
}): React.JSX.Element => {
  const Icon = kindIcons[kind ?? 'other'] ?? WrenchIcon
  return <Icon {...props} />
}

export type ToolHeaderProps = {
  title?: string
  icon?: string
  statusLabel?: string
  className?: string
} & (
  | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
  | {
      type: DynamicToolUIPart['type']
      state: DynamicToolUIPart['state']
      toolName: string
    }
)

const statusLabels: Record<ToolPart['state'], string> = {
  'approval-requested': '等待批准',
  'approval-responded': '已响应',
  'input-available': '运行中',
  'input-streaming': '等待中',
  'output-available': '已完成',
  'output-denied': '已拒绝',
  'output-error': '错误'
}

const statusIcons: Record<ToolPart['state'], ReactNode> = {
  'approval-requested': <ClockIcon className="size-4 text-yellow-600" />,
  'approval-responded': <CheckCircleIcon className="size-4 text-blue-600" />,
  'input-available': <ClockIcon className="size-4 animate-pulse" />,
  'input-streaming': <CircleIcon className="size-4" />,
  'output-available': <CheckCircleIcon className="size-4 text-green-600" />,
  'output-denied': <XCircleIcon className="size-4 text-orange-600" />,
  'output-error': <XCircleIcon className="size-4 text-red-600" />
}

const getStatusBadge = (status: ToolPart['state'], label?: string): React.JSX.Element => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {label ?? statusLabels[status]}
  </Badge>
)

export const ToolHeader = ({
  className,
  title,
  icon,
  statusLabel,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps): React.JSX.Element => {
  const derivedName = type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-')
  return (
    <CollapsibleTrigger
      className={cn('flex w-full min-w-0 items-center justify-between gap-4 p-3', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ToolIcon kind={icon} className="size-4 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-left font-medium text-sm"
          title={title ?? derivedName}
        >
          {title ?? derivedName}
        </span>
        <span className="shrink-0">{getStatusBadge(state, statusLabel)}</span>
      </div>
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({
  children,
  className,
  ...props
}: ToolContentProps): React.JSX.Element => {
  const open = useContext(ToolOpenContext)

  return (
    <CollapsibleContent
      className={cn(
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    >
      {open ? children : null}
    </CollapsibleContent>
  )
}

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input']
}

const cleanToolInput = (input: ToolPart['input']): unknown => {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'title' in input) {
    return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'title'))
  }
  return input
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps): React.JSX.Element => (
  <div className={cn('space-y-2 overflow-hidden', className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">参数</h4>
    <div className="max-h-80 overflow-y-auto rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(cleanToolInput(input), null, 2) ?? ''} language="json" />
    </div>
  </div>
)

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolPart['output']
  errorText: ToolPart['errorText']
}

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps): React.JSX.Element | null => {
  if (output == null && !errorText) {
    return null
  }

  let Output: ReactNode
  if (isValidElement(output)) {
    Output = output
  } else if (typeof output === 'string') {
    Output = <CodeBlock code={output} language="json" />
  } else {
    Output = <CodeBlock code={JSON.stringify(output, null, 2) ?? ''} language="json" />
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? '错误' : '结果'}
      </h4>
      <div
        className={cn(
          'max-h-80 overflow-auto rounded-md text-xs [&_table]:w-full',
          errorText ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground'
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  )
}
