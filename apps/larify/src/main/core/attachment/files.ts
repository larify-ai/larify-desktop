import { readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isFileUIPart, type FileUIPart, type UIMessage } from 'ai'
import { sessionAttachmentsPath } from '../../utils/app-paths'

async function saveFile(sessionId: string, part: FileUIPart): Promise<FileUIPart> {
  if (!part.url.startsWith('data:')) return part

  const target = join(
    sessionAttachmentsPath(sessionId),
    `${randomUUID()}${extname(part.filename ?? '')}`
  )
  const data = await fetch(part.url).then((response) => response.arrayBuffer())
  await writeFile(target, Buffer.from(data))
  return { ...part, url: target }
}

export async function saveAttachments(sessionId: string, message: UIMessage): Promise<UIMessage> {
  return {
    ...message,
    parts: await Promise.all(
      message.parts.map((part) => (isFileUIPart(part) ? saveFile(sessionId, part) : part))
    )
  }
}

async function loadFile(part: FileUIPart): Promise<FileUIPart> {
  if (!part.mediaType.startsWith('image/') || !isAbsolute(part.url)) return part
  const data = await readFile(part.url).catch(() => undefined)
  return data ? { ...part, url: `data:${part.mediaType};base64,${data.toString('base64')}` } : part
}

export async function loadAttachments(messages: UIMessage[]): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map((part) => (isFileUIPart(part) ? loadFile(part) : part))
      )
    }))
  )
}
