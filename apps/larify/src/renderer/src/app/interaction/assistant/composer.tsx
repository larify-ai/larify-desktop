import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChatStatus } from 'ai'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
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

interface AssistantComposerProps {
  cwd: string
  history: string[]
  status: ChatStatus
  showWorkspace: boolean
  onCwdChange: (cwd: string) => void
  onSubmit: (message: PromptInputMessage) => void
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

function ComposerFooter({
  inputRef,
  status,
  text,
  onStop
}: {
  inputRef: RefObject<HTMLDivElement | null>
  status: ChatStatus
  text: string
  onStop: () => void
}): React.JSX.Element {
  const attachments = usePromptInputAttachments()
  const running = status === 'submitted' || status === 'streaming'

  return (
    <PromptInputFooter className="justify-between">
      <PromptInputTools className="flex-1 overflow-hidden">
        <ComposerMenu inputRef={inputRef} />
      </PromptInputTools>
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
    onSubmit({ text: value, files: message.files })
  }

  const stop = (): void => {
    if (stopping.current) return
    stopping.current = true
    onStop()
  }

  return (
    <div className="-mt-4 mx-auto w-full max-w-4xl px-6 pb-4">
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
          <ComposerFooter inputRef={inputRef} status={status} text={text} onStop={stop} />
        </PromptInput>
      </div>
    </div>
  )
}
