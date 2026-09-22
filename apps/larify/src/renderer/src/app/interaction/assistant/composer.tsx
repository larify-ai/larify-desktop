import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChatStatus } from 'ai'
import { ArrowUpIcon, ListChecksIcon, SquareIcon } from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputAttachments
} from '@renderer/components/ai-elements/prompt-input'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments
} from '@renderer/components/ai-elements/attachments'
import { useComposerHistory } from './composer-history'
import { ComposerMenu } from './composer-menu'
import { WorkspaceSelector } from './workspace-selector'
import { ModelSelector } from './model-selector'

export interface AssistantComposerSubmit extends PromptInputMessage {
  /** 计划模式：开启时给本轮输入拼 `/follow_workflow` 前缀（默认关闭、不持久化）。 */
  workflowPrefix: boolean
}

interface AssistantComposerProps {
  cwd: string
  history: string[]
  status: ChatStatus
  showWorkspace: boolean
  onCwdChange: (cwd: string) => void
  onSubmit: (message: AssistantComposerSubmit) => void
  onStop: () => void
}

function AttachmentList(): React.JSX.Element | null {
  const attachments = usePromptInputAttachments()

  if (!attachments.files.length) return null

  return (
    <PromptInputHeader className="w-full px-3 pt-3 pb-0">
      <Attachments variant="inline" className="ml-0 w-full">
        {attachments.files.map((file) => (
          <Attachment
            className={file.filename ? undefined : 'gap-0'}
            data={file}
            key={file.id}
            onRemove={() => attachments.remove(file.id)}
          >
            <AttachmentPreview />
            {file.filename && <AttachmentInfo />}
            <AttachmentRemove className={file.filename ? undefined : 'absolute -top-2 -right-2'} />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  )
}

/**
 * 计划模式开关：行内「打勾清单图标 + 计划模式 + 滑动开关」，点击整行即切换。
 * 开启后本轮用户输入才会拼 `/follow_workflow` 前缀。默认关闭、不持久化（纯内存态）。
 *
 * 尺寸/圆角/hover 与右侧 `ModelSelector` 对齐（同为 `Button size="sm"` 的 `h-7 gap-1 rounded-md
 * px-2` + `hover:bg-accent`）；`PromptInputButton` 默认走 `InputGroupButton` 的 `sm`（`h-8 px-2.5`），
 * 高度与内距都更大，故此处显式覆写，避免两个相邻控件 hover 框大小/圆角不一致。
 */
function PlanModeToggle({
  value,
  onChange
}: {
  value: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <PromptInputButton
      aria-label="计划模式"
      aria-pressed={value}
      role="switch"
      className={
        value
          ? 'h-7 gap-1 rounded-md border border-transparent bg-transparent px-2 text-foreground has-[>svg]:px-2 hover:bg-accent hover:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0'
          : 'h-7 gap-1 rounded-md border border-transparent bg-transparent px-2 text-muted-foreground has-[>svg]:px-2 hover:bg-accent hover:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0'
      }
      onClick={() => onChange(!value)}
    >
      <ListChecksIcon className="size-4" />
      计划模式
      <span
        aria-hidden
        className={
          value
            ? 'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-primary transition-colors'
            : 'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-muted-foreground/30 transition-colors'
        }
      >
        <span
          className={
            value
              ? 'inline-block size-3 translate-x-3.5 rounded-full bg-primary-foreground transition-transform'
              : 'inline-block size-3 translate-x-0.5 rounded-full bg-background transition-transform'
          }
        />
      </span>
    </PromptInputButton>
  )
}

function ComposerFooter({
  inputRef,
  status,
  text,
  planMode,
  onPlanModeChange,
  onStop
}: {
  inputRef: RefObject<HTMLDivElement | null>
  status: ChatStatus
  text: string
  planMode: boolean
  onPlanModeChange: (value: boolean) => void
  onStop: () => void
}): React.JSX.Element {
  const attachments = usePromptInputAttachments()
  const running = status === 'submitted' || status === 'streaming'

  return (
    <PromptInputFooter className="justify-between">
      <PromptInputTools className="flex-1 overflow-hidden">
        <ComposerMenu inputRef={inputRef} />
        <PlanModeToggle value={planMode} onChange={onPlanModeChange} />
      </PromptInputTools>
      <ModelSelector disabled={running} />
      <PromptInputSubmit
        status={status}
        onStop={onStop}
        disabled={!running && !text.trim() && attachments.files.length === 0}
        className="rounded-full disabled:bg-primary disabled:text-primary-foreground disabled:opacity-50"
      >
        {running ? <SquareIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
      </PromptInputSubmit>
    </PromptInputFooter>
  )
}

export function AssistantComposer({
  cwd,
  history,
  status,
  showWorkspace,
  onCwdChange,
  onSubmit,
  onStop
}: AssistantComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [planMode, setPlanMode] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)
  const submitting = useRef(false)
  const stopping = useRef(false)
  const running = status === 'submitted' || status === 'streaming'
  const inputHistory = useComposerHistory(history, setText)

  useEffect(() => {
    if (status !== 'submitted' && status !== 'streaming') {
      submitting.current = false
      stopping.current = false
    }
  }, [status])

  const submit = (message: PromptInputMessage): void => {
    if (running || submitting.current) return
    const value = message.text.trim()
    if (!value && !message.files.length) return
    submitting.current = true
    inputHistory.reset()
    setText('')
    onSubmit({ text: value, files: message.files, workflowPrefix: planMode })
  }

  const stop = (): void => {
    if (stopping.current) return
    stopping.current = true
    onStop()
  }

  return (
    <div className="-mt-4 mx-auto w-full max-w-4xl px-6 pb-4" data-composer-layout-shell>
      <div
        ref={inputRef}
        className="relative z-10 w-full overflow-hidden rounded-2xl bg-card shadow-sm"
      >
        {showWorkspace && (
          <div className="w-full">
            <WorkspaceSelector cwd={cwd} disabled={running} onChange={onCwdChange} />
          </div>
        )}
        <PromptInput onSubmit={submit} multiple className="[&_[data-slot=input-group]]:rounded-2xl">
          <AttachmentList />
          <PromptInputBody>
            <PromptInputTextarea
              placeholder="描述任务..."
              value={text}
              onChange={inputHistory.onChange}
              onKeyDown={inputHistory.onKeyDown}
              className="max-h-48 min-h-12 overflow-y-auto pl-3"
            />
          </PromptInputBody>
          <ComposerFooter
            inputRef={inputRef}
            status={status}
            text={text}
            planMode={planMode}
            onPlanModeChange={setPlanMode}
            onStop={stop}
          />
        </PromptInput>
      </div>
    </div>
  )
}
