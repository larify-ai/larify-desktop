import { readFile, stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { imageSize } from 'image-size'
import { z } from 'zod'
import { imageCapableModelIds, type ModelId } from '../../../main/core/model/config'
import { saveAttachmentBytes } from '../../../main/core/attachment/store'
import { defineTool } from '../../../main/core/plugin/protocol'

const MAX_IMAGE_BYTES = 200 * 1024
/**
 * DeepSeek rejects any image whose width or height exceeds 8192 px, and drops
 * the per-side limit to 4096 px when a request carries 15 or more images. An
 * image that slips past this gate is replayed from history on every later
 * request, so a single oversized screenshot permanently fails the session.
 * These bounds mirror the official `read_image` admission limits
 * (maxImageDimension / maxImagePixels).
 */
const MAX_IMAGE_DIMENSION = 8192
const MAX_IMAGE_PIXELS = 64_000_000
const imageMediaTypes: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
])

const inputSchema = z
  .object({
    file_path: z.string().trim().min(1).describe('Absolute path to the image file')
  })
  .strict()

interface ReadImageOutput {
  storedPath: string
  filename: string
  mediaType: string
}

export const readImageTool = defineTool({
  description: 'Read a local PNG, JPEG, WebP, or GIF image.',
  metadata: { icon: 'image', eager: true },
  inputSchema,
  execute: async ({ file_path }, ctx): Promise<ReadImageOutput> => {
    const modelId = ctx.modelId
    if (!modelId || !imageCapableModelIds.has(modelId as ModelId)) {
      throw new Error('Current model does not support images.')
    }

    const target = resolve(ctx.cwd, file_path)
    const extension = extname(target).toLowerCase()
    const mediaType = imageMediaTypes.get(extension)
    if (!mediaType) {
      throw new Error(`Cannot read image: "${target}" must be a PNG, JPEG, WebP, or GIF path.`)
    }

    const info = await stat(target)
    if (!info.isFile()) throw new Error(`Cannot read image: "${target}" is not a regular file.`)
    if (info.size > MAX_IMAGE_BYTES) {
      throw new Error(`Cannot read image: file exceeds the 200 KB limit. Downscale the image and read the smaller copy.`)
    }

    const data = await readFile(target, { signal: ctx.signal })
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Cannot read image: file exceeds the 200 KB limit. Downscale the image and read the smaller copy.`)
    }
    const detected = await fileTypeFromBuffer(data)
    if (!detected || ![...imageMediaTypes.values()].includes(detected.mime)) {
      throw new Error('Cannot read image: only PNG, JPEG, WebP, and GIF files are supported.')
    }
    if (detected.mime !== mediaType) {
      throw new Error(
        `Cannot read image: the ${extension} extension declares ${mediaType}, but the file contains ${detected.mime}.`
      )
    }

    const size = imageSize(data)
    if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
      throw new Error(
        `Cannot read image: "${target}" is ${size.width}x${size.height} px, and at least one side exceeds the ${MAX_IMAGE_DIMENSION}px limit. Downscale the image and read the smaller copy.`
      )
    }
    if (size.width * size.height > MAX_IMAGE_PIXELS) {
      throw new Error(
        `Cannot read image: "${target}" is ${size.width}x${size.height} px, exceeding the ${MAX_IMAGE_PIXELS}-pixel limit. Downscale the image and read the smaller copy.`
      )
    }

    const storedPath = await saveAttachmentBytes(ctx.sessionId, data)

    return {
      storedPath,
      filename: basename(target),
      mediaType
    }
  },
  toModelOutput: async (output) => ({
    type: 'content',
    value: [
      {
        type: 'file',
        filename: output.filename,
        mediaType: output.mediaType,
        data: { type: 'data', data: await readFile(output.storedPath) }
      }
    ]
  })
})
