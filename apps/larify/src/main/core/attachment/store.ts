import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { sessionAttachmentsPath } from '../../utils/app-paths'

function digestOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('base64url')
}

async function hasDigest(path: string, digest: string, bytes: number): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size !== bytes) return false
    return digestOf(await readFile(path)) === digest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function publish(target: string, digest: string, data: Uint8Array): Promise<void> {
  if (await hasDigest(target, digest, data.byteLength)) return

  const directory = dirname(target)
  const temporary = join(directory, `${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, data, { flag: 'wx' })
    try {
      await rename(temporary, target)
    } catch (error) {
      if (await hasDigest(target, digest, data.byteLength)) return
      throw error
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function saveAttachmentBytes(sessionId: string, data: Uint8Array): Promise<string> {
  const directory = sessionAttachmentsPath(sessionId)
  const digest = digestOf(data)
  const type = await fileTypeFromBuffer(data)
  const suffix = type ? `.${type.ext}` : ''
  const target = join(directory, `${digest}${suffix}`)
  await publish(target, digest, data)
  return target
}
