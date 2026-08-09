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
  const agentStream = runAgent(await toModelMessages(messages, options.tools), options)
  let finalMessages = messages
  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: errorMessage,
    execute: ({ writer }) => {
      writer.merge(toUIMessageStream({ stream: agentStream, onError: errorMessage }))
    },
    onStepEnd: ({ responseMessage }) => onMessage?.(responseMessage),
    onEnd: (event) => {
      finalMessages = event.messages
    }
  })
  for await (const chunk of stream) onChunk?.(chunk)
  return finalMessages
}
