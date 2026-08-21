import { createUIMessageStream, toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { errorMessage } from '../../utils/error'
import { runAgent, type AgentOptions } from './engine'
import { toModelMessages } from './messages'

export async function runAgentSession(
  messages: UIMessage[],
  options: AgentOptions,
  onChunk?: (chunk: UIMessageChunk) => void,
  onMessage?: (message: UIMessage) => void
): Promise<UIMessage[]> {
  const startedAt = Date.now()
  const agentStream = runAgent(await toModelMessages(messages, options.tools), options)
  let finalMessages = messages
  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: errorMessage,
    execute: async ({ writer }) => {
      const uiStream = toUIMessageStream({
        stream: agentStream,
        onError: errorMessage,
        messageMetadata: ({ part }) => {
          if (part.type === 'start') return { startedAt }
          if (part.type === 'finish') return { completedAt: Date.now() }
          if (part.type === 'abort') {
            return { completedAt: Date.now(), outcome: 'aborted' as const }
          }
          return undefined
        }
      })
      const reader = uiStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          writer.write(value)
        }
      } catch (error) {
        writer.write({ type: 'error', errorText: errorMessage(error) })
        writer.write({
          type: 'message-metadata',
          messageMetadata: { completedAt: Date.now(), outcome: 'error' }
        })
      } finally {
        reader.releaseLock()
      }
    },
    onStepEnd: ({ responseMessage }) => onMessage?.(responseMessage),
    onEnd: (event) => {
      finalMessages = event.messages
    }
  })
  for await (const chunk of stream) onChunk?.(chunk)
  return finalMessages
}
