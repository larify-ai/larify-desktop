import type { FileUIPart } from 'ai'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments
} from '@renderer/components/ai-elements/attachments'

export function FileAttachments({
  files,
  messageId
}: {
  files: FileUIPart[]
  messageId: string
}): React.JSX.Element {
  return (
    <Attachments variant="inline" className="group-[.is-user]:ml-auto group-[.is-user]:justify-end">
      {files.map((file, index) => {
        const id = `${messageId}-${index}`
        return (
          <Attachment data={{ ...file, id }} key={id}>
            <AttachmentPreview />
            <AttachmentInfo />
          </Attachment>
        )
      })}
    </Attachments>
  )
}
