import { useEffect, useRef, useState } from 'react'
import type { ChatStatus } from 'ai'
import { FolderIcon } from 'lucide-react'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
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

interface AssistantComposerProps {
  history: string[]
  status: ChatStatus
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
          <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  )
}

function DirectoryAttachment(): React.JSX.Element {
  const attachments = usePromptInputAttachments()

  const select = async (): Promise<void> => {
    const paths = await window.bridge.invoke('dialog:pick-directories')
    if (!Array.isArray(paths)) return
    attachments.addParts(
      paths
        .filter((path): path is string => typeof path === 'string')
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

function ComposerFooter({
  status,
  text,
  onStop
}: {
  status: ChatStatus
  text: string
  onStop: () => void
}): React.JSX.Element {
  const attachments = usePromptInputAttachments()
  const running = status === 'submitted' || status === 'streaming'

  return (
    <PromptInputFooter className="justify-between">
      <PromptInputTools>
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger tooltip="添加附件" />
          <PromptInputActionMenuContent>
            <PromptInputActionAddAttachments label="文件" />
            <DirectoryAttachment />
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>
      </PromptInputTools>
      <PromptInputSubmit
        status={status}
        onStop={onStop}
        disabled={!running && !text.trim() && attachments.files.length === 0}
        className="rounded-full"
      />
    </PromptInputFooter>
  )
}

export function AssistantComposer({
  history,
  status,
  onSubmit,
  onStop
}: AssistantComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const submitting = useRef(false)
  const stopping = useRef(false)
  const running = status === 'submitted' || status === 'streaming'
  const inputHistory = useComposerHistory(history, setText)

  useEffect(() => {
    if (!running) {
      submitting.current = false
      stopping.current = false
    }
  }, [running])

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
    <div className="pr-[var(--larify-scrollbar-size)]">
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
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
          <ComposerFooter status={status} text={text} onStop={stop} />
        </PromptInput>
      </div>
    </div>
  )
}
