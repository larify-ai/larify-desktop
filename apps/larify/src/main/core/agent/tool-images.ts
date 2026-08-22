import type { LanguageModelV4Prompt } from '@ai-sdk/provider'

type ToolMessage = Extract<LanguageModelV4Prompt[number], { role: 'tool' }>
type ToolResult = Extract<ToolMessage['content'][number], { type: 'tool-result' }>
type ContentOutput = Extract<ToolResult['output'], { type: 'content' }>
type ContentValue = ContentOutput['value'][number]
type FileValue = Extract<ContentValue, { type: 'file' }>

function isImageFile(value: ContentValue): value is FileValue {
  return (
    value.type === 'file' && (value.mediaType === 'image' || value.mediaType.startsWith('image/'))
  )
}

/**
 * DeepSeek Chat Completions only accepts image blocks in user messages. AI SDK
 * represents rich tool outputs inside tool messages, so lift their image files
 * into an immediately following user message before the provider serializes the prompt.
 */
export function promoteToolImages(
  prompt: LanguageModelV4Prompt,
  imageCapable: boolean
): LanguageModelV4Prompt {
  const result: LanguageModelV4Prompt = []

  for (const message of prompt) {
    if (message.role !== 'tool') {
      result.push(message)
      continue
    }

    const images: FileValue[] = []
    const content = message.content.map((part) => {
      if (
        part.type !== 'tool-result' ||
        part.toolName !== 'fs_read_image' ||
        part.output.type !== 'content'
      ) {
        return part
      }
      const outputImages = part.output.value.filter(isImageFile)
      if (!outputImages.length) return part
      if (imageCapable) images.push(...outputImages)
      return { ...part, output: { type: 'text' as const, value: 'Image loaded.' } }
    })

    result.push({ ...message, content })
    if (images.length) {
      result.push({
        role: 'user',
        content: images
      })
    }
  }

  return result
}
